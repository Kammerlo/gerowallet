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
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
});

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
