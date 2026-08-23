// The governance home is a projection of ONE derived state, so what is worth
// asserting here is the projection: that the state the wallet is actually in
// decides which surface renders, and that the withdrawal gate is reachable from
// exactly one of them.
//
// Everything with a transaction, a network call or a router behind it is mocked
// — useWithdrawal drags the Cardano builder in, and the gate dialog drags the
// whole signing stack. Neither is what this file owns.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue, { ref } from 'vue';
import { Cardano } from '@cardano-sdk/core';

const withdraw = vi.fn();
const closeWithdrawalDialog = vi.fn();
const withdrawalBlocked = ref(false);

vi.mock('@/shared/composables/useWithdrawal', () => ({
  useWithdrawal: () => ({ withdraw, withdrawalBlocked, closeWithdrawalDialog }),
}));

const getDRepById = vi.fn();
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: (...args: unknown[]) => getDRepById(...args) } }));

vi.mock('@/modules/governance/dialogs/WithdrawGateDialog.vue', () => ({
  default: { name: 'WithdrawGateDialog', props: ['isOpen'], render: () => null },
}));

vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import MyGovernance from './MyGovernance.vue';
import { walletStore } from '@/stores/walletStore';
import { governanceStore } from '@/stores/governanceStore';
import { networkStore } from '@/stores/networkStore';

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

/** A wallet delegated to a pool but to no DRep: rewards are locked. */
function registeredNoDRep(): void {
  walletStore.account = {
    active: true,
    pool_id: 'pool1abc',
    drep_id: '',
    controlled_amount: '23718000000',
    withdrawable_amount: '412390000',
  } as unknown as typeof walletStore.account;
}

function represented(): void {
  walletStore.account = {
    active: true,
    pool_id: 'pool1abc',
    drep_id: 'drep1yfrexample',
    controlled_amount: '23718000000',
    withdrawable_amount: '0',
  } as unknown as typeof walletStore.account;
}

function mountPage(): Wrapper<Vue> {
  return mount(MyGovernance, {
    mocks: { $t },
    stubs: {
      'v-icon': true,
      'v-skeleton-loader': true,
      AsOf: true,
      // Only the Vuetify layer is stubbed. GButton, EmptyState and ErrorState
      // are `<script setup>` imports, which Vue 2.7 resolves lexically — a
      // `stubs` entry keyed by their name is silently ignored, so they render
      // for real and their classes/props are what the assertions below match.
      //
      // This stub must forward BOTH attrs and listeners onto a real <button>:
      // GButton reaches v-btn through `v-on="$listeners"`, so a stub that
      // swallowed them would leave every click assertion passing vacuously
      // against a button that does nothing.
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/** Every rendered GButton, matched by the class GButton always applies. */
function buttonsLabelled(w: Wrapper<Vue>, label: string) {
  return w.findAll('.g-btn').filter(b => b.text().includes(label));
}

/** Let the mounted fetch settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  withdrawalBlocked.value = false;
  getDRepById.mockResolvedValue(null);
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' };
  walletStore.keys = null;
  walletStore.transactions = [];
  governanceStore.currentDRep = null;
  governanceStore.currentCompensationBps = null;
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  // The tile tests below drive the epoch through the real store; leaving a tip
  // behind would silently change every other case's expiry arithmetic.
  networkStore.tip = null;
});

/** Captions under the three health tiles — the line each tile hangs off its fact. */
function tileCaptions(w: Wrapper<Vue>) {
  return w.findAll('.my-governance__tile .t-caption');
}

describe('MyGovernance', () => {
  it('offers the three unlock choices, and only them, when rewards are locked', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await Vue.nextTick();

    const html = wrapper.html();
    expect(html).toContain('governance.status.registeredNoDRep.title');
    expect(html).toContain('governance.delegateToADRep');
    expect(html).toContain('governance.alwaysAbstain');
    expect(html).toContain('governance.alwaysNoConfidence');
    // Every one of them unlocks, and the page says so on each.
    expect(html.split('governance.unlocksWithdrawals').length - 1).toBe(3);
    // The delegated-state surfaces stay away.
    expect(html).not.toContain('governance.howYourStakeWasCast');
  });

  it('renders the locked reward balance exactly, without narrowing it through Number', async () => {
    registeredNoDRep();
    walletStore.account = {
      ...walletStore.account,
      withdrawable_amount: '90071992547409910',
    } as unknown as typeof walletStore.account;
    wrapper = mountPage();
    await Vue.nextTick();

    // 90071992547409910 lovelace is past Number.MAX_SAFE_INTEGER; the exact
    // figure must survive to the formatter.
    expect(wrapper.html()).toContain('90,071,992,547.41');
  });

  it('raises the withdrawal gate from the locked balance, not from a dead end', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await Vue.nextTick();

    const gate = wrapper.findComponent({ name: 'WithdrawGateDialog' });
    expect(gate.props('isOpen')).toBe(false);

    const withdrawButton = buttonsLabelled(wrapper, 'staking.withdraw');
    expect(withdrawButton).toHaveLength(1);

    withdrawButton.at(0).trigger('click');
    await Vue.nextTick();
    expect(withdraw).toHaveBeenCalledTimes(1);

    // The composable's blocked branch is what actually opens it.
    withdrawalBlocked.value = true;
    await Vue.nextTick();
    expect(gate.props('isOpen')).toBe(true);
  });

  it('never offers the gate in a state that can already withdraw', async () => {
    represented();
    wrapper = mountPage();
    await Vue.nextTick();

    expect(wrapper.html()).toContain('governance.status.represented.title');
    expect(wrapper.html()).not.toContain('governance.withdrawalLocked');
    expect(buttonsLabelled(wrapper, 'staking.withdraw')).toHaveLength(0);
  });

  it('shows one row per proposal, newest first, when the DRep has voted twice on one action', async () => {
    represented();
    // No `drep_id` on the record: the composable trusts a record fetched BY the
    // delegated id, and a fake bech32 would fail credential comparison.
    getDRepById.mockResolvedValue({
      registered: true,
      votes: [
        { proposal_id: 'aa11', vote: 'no', block_time: 100, meta_url: '' },
        { proposal_id: 'aa11', vote: 'yes', block_time: 200, meta_url: 'https://example.test/r.json' },
        { proposal_id: 'bb22', vote: 'abstain', block_time: 150 },
      ],
    });

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    // The re-vote collapses to the newest: yes, with its rationale, not no.
    expect(html).toContain('governance.votedYes');
    expect(html).toContain('governance.rationaleAttached');
    expect(html).not.toContain('governance.votedNo');
    expect(html).toContain('governance.votedAbstain');
  });

  it('reports a DRep with no votes as n/a, never as 0%', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    // The recent tile formats its own string, so a wrong 0 would read "0%"...
    expect(html).toContain('common.notAvailable');
    expect(html).not.toContain('0%');
    // ...but the long-run line goes through $t, where a wrong 0 would hide
    // inside the interpolation params rather than the rendered text. The mock
    // echoes them precisely so this stays a real assertion.
    expect(html).not.toContain('"pct":0');
    expect(html).toContain('governance.noVotesYet');
  });

  // The health tiles state facts. A tile whose caption is unknown must show
  // LESS, never something that reads as a claim: "n/a" printed under a real
  // date says the date is unknown, which is the opposite of true, and
  // "stays active for 0 more epochs" is the exact falsehood the trust
  // hierarchy discards a stale expiry to avoid.
  describe('health tile captions', () => {
    it('renders no caption at all when the countdown is unknown', async () => {
      represented();
      networkStore.tip = { epoch: 651 } as unknown as typeof networkStore.tip;
      // `active: true` beside an already-passed expiry is the stale-index
      // signature: delegationHealth sets expiryStale and nulls epochsLeft.
      getDRepById.mockResolvedValue({
        registered: true,
        active: true,
        expires_epoch_no: 629,
        votes: [],
      });

      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      // Neither the countdown nor the expiry it was derived from.
      expect(html).not.toContain('governance.activeForEpochs');
      expect(html).not.toContain('governance.expiresEpochLabel');
      // And no filler standing in for them: "On-chain data" under a vote count
      // says nothing the tile's own label did not already say.
      expect(html).not.toContain('governance.onchainData');
      // One caption survives — the long-run rationale line, which is a real
      // fact about a record with no votes — and the two unknown ones are gone.
      expect(tileCaptions(wrapper)).toHaveLength(1);
      // The tiles themselves stay: they still carry the facts they do have.
      expect(html).toContain('governance.lastVote');
      expect(html).toContain('governance.votes');
    });

    it('still renders the caption when the countdown is coherent', async () => {
      represented();
      networkStore.tip = { epoch: 651 } as unknown as typeof networkStore.tip;
      getDRepById.mockResolvedValue({
        registered: true,
        expires_epoch_no: 660,
        votes: [],
      });

      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      // 660 − 651 = 9 epochs left, and the stored expiry is worth stating.
      expect(html).toContain('governance.activeForEpochs:{"n":9}');
      expect(html).toContain('governance.expiresEpochLabel:{"n":660}');
      expect(tileCaptions(wrapper)).toHaveLength(3);
    });
  });

  // The delegation-alerts panel drops into the slot under the hero and raises
  // its own gradient CTA when an alert is live. Any gradient this page renders
  // in a delegated state would be the second one on screen.
  it('claims no gradient CTA in a delegated state, alerts panel or not', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    wrapper = mountPage();
    await settle();

    expect(wrapper.findAll('.g-btn--primary')).toHaveLength(0);
  });

  it('still yields the gradient when the DRep has retired, since the alert owns it', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: false, votes: [] });
    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.status.drepRetired.title');
    expect(html).toContain('governance.findAReplacement');
    expect(wrapper.findAll('.g-btn--primary')).toHaveLength(0);
  });

  it('keeps exactly one gradient where no alert can exist', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await settle();

    // The delegate choice card, and nothing else.
    const primaries = wrapper.findAll('.g-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries.at(0).text()).toContain('governance.browseDReps');
  });

  // CardanoGovernance.vue was the only dashboard-context writer of these, and
  // it is gone. useWithdrawal.compensationInfo reads both to decide whether a
  // withdrawal carries a CIP-149 donation output, so without this the donation
  // would silently stop being attached.
  describe('governance store hydration', () => {
    /** A confirmed vote delegation carrying a 5% CIP-149 donation rate. */
    function delegationTxWithDonation(bps: number, pending = false) {
      return {
        pending,
        block_height: 100,
        body: { certificates: [{ __typename: Cardano.CertificateType.VoteDelegation }] },
        auxiliaryData: { blob: new Map([[3692n, new Map([['donationBasisPoints', bps]])]]) },
      };
    }

    it('populates currentDRep from the record it already fetched', async () => {
      represented();
      const drepRecord = {
        registered: true,
        votes: [],
        metadata: { meta_json: { body: { paymentAddress: 'addr1qexample' } } },
      };
      getDRepById.mockResolvedValue(drepRecord);

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual(drepRecord);
      // One request, not two: hydration reuses the page's own fetch rather
      // than repeating it through governanceStore.loadDRepById.
      expect(getDRepById).toHaveBeenCalledTimes(1);
    });

    it('recovers the committed donation rate from the newest confirmed delegation', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });
      walletStore.transactions = [delegationTxWithDonation(50)];

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentCompensationBps).toBe(50);
    });

    it('ignores a pending delegation, which the chain has not agreed to yet', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });
      walletStore.transactions = [delegationTxWithDonation(50, true)];

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentCompensationBps).toBeNull();
    });

    it('clears both when the wallet has no DRep to donate to', async () => {
      governanceStore.currentDRep = { drep_id: 'stale' };
      governanceStore.currentCompensationBps = 50;
      registeredNoDRep();

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toBeNull();
      expect(governanceStore.currentCompensationBps).toBeNull();
    });

    it('keeps a good record rather than blanking it on a transient lookup failure', async () => {
      represented();
      governanceStore.currentDRep = { drep_id: 'drep1yfrexample' };
      getDRepById.mockRejectedValue(new Error('boom'));

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual({ drep_id: 'drep1yfrexample' });
    });
  });

  describe('predefined choices', () => {
    function abstaining(): void {
      walletStore.account = {
        active: true,
        pool_id: 'pool1abc',
        drep_id: 'drep_always_abstain',
        controlled_amount: '23718000000',
        withdrawable_amount: '0',
      } as unknown as typeof walletStore.account;
    }

    it('names the position instead of rendering the keyword as an id', async () => {
      abstaining();
      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      expect(html).toContain('governance.alwaysAbstain');
      // The keyword is a position, not a credential: no truncated "id" line.
      expect(html).not.toContain('drep_always_abstain');
      expect(wrapper.findAll('.my-governance__drep-id')).toHaveLength(0);
      // And nothing to look up, so no doomed 404 on mount.
      expect(getDRepById).not.toHaveBeenCalled();
    });

    it('records the keyword in the store so the withdrawal path still sees a delegation', async () => {
      abstaining();
      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual({ drep_id: 'drep_always_abstain' });
    });
  });

  it('refreshes when the delegation changes, without a reload', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await settle();
    expect(wrapper.html()).toContain('governance.status.registeredNoDRep.title');
    expect(getDRepById).not.toHaveBeenCalled();

    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    walletStore.account = {
      ...walletStore.account,
      drep_id: 'drep1yfrexample',
    } as unknown as typeof walletStore.account;
    await settle();

    expect(getDRepById).toHaveBeenCalledTimes(1);
    expect(wrapper.html()).toContain('governance.status.represented.title');
    // The unlock choices are gone. (The hero title is not a safe probe here:
    // the legend names every state by design.)
    expect(wrapper.html()).not.toContain('governance.unlocksWithdrawals');
  });

  it('surfaces a retryable error instead of an empty page when the lookup fails', async () => {
    represented();
    getDRepById.mockRejectedValue(new Error('boom'));

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.drepLookupFailed');
    // The state surfaces are gone; only the error is offered, with its retry.
    expect(html).not.toContain('governance.howYourStakeWasCast');
  });
});
