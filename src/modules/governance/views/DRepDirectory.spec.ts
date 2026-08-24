// The DRep directory as rendered.
//
// `drepDirectory.sort.spec.ts` pins the ordering rule itself; this file pins
// that the page WIRES it: the column headers are real buttons, the active one
// announces its direction, the arriving order is participation and never power,
// and each row's delegate control acts on that row's own record.
//
// Everything with a network call, a chain SDK or a signing surface behind it is
// mocked. The Vuetify layer is stubbed; GButton and the feedback components are
// `<script setup>` imports that Vue 2.7 resolves lexically, so they render for
// real and the buttons under test are real buttons.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

// `vi.mock` factories are hoisted above every const in this file, and the view's
// own imports are hoisted above them again — so anything a factory touches has
// to be hoisted too, not merely declared first.
const h = vi.hoisted(() => ({
  getDRepsPaginated: vi.fn(),
  delegateToDRep: vi.fn(),
  delegateToPredefined: vi.fn(),
  // walletStore and networkStore both drag in the chain SDK; the view reads a
  // handful of fields off each, so stand those fields up directly.
  wallet: {
    loggedWallet: { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' },
    account: { drep_id: null as string | null },
    keys: null as unknown,
    utxos: null as unknown,
    isSyncing: false,
  },
  network: { epochParams: null as unknown },
  // Participation is votes-cast over ELIGIBLE ACTIONS, so the denominator has to
  // exist or every DRep is "pending" and the sort has nothing to order by. Four
  // loaded actions is the denominator; the sample proposal id on the DRep rows
  // is not canonical, so `drepStats` falls back to this count rather than to an
  // exact id window, which is the honest path the view already documents.
  actionsState: {
    actions: Array.from({ length: 4 }, (_, i) => ({
      govActionId: `${'ab'.repeat(32)}#${i}`,
      govActionIdCip129: null,
      type: 'InfoAction',
    })),
  },
}));

vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => h.getDRepsPaginated(...args) },
}));

vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet, default: { state: h.wallet } }));

vi.mock('@/stores/networkStore', () => ({
  networkStore: h.network,
  default: { getCurrentEpoch: () => 650, state: h.network },
}));

vi.mock('@/stores/governanceActionsStore', () => ({
  default: { state: h.actionsState, loadActions: vi.fn(async () => undefined) },
}));

vi.mock('@/modules/governance/composables/useDRepDelegation', async () => {
  const { ref } = await import('vue');
  return {
    useDRepDelegation: () => ({
      selectedDRep: ref(null),
      tx: ref(null),
      isDialogOpen: ref(false),
      building: ref(null),
      delegateToDRep: (...args: unknown[]) => h.delegateToDRep(...args),
      delegateToPredefined: (...args: unknown[]) => h.delegateToPredefined(...args),
      closeDialog: vi.fn(),
    }),
  };
});

vi.mock('@/modules/governance/dialogs/DRepDelegateDialog.vue', () => ({
  default: { name: 'DRepDelegateDialog', props: ['isOpen', 'drep', 'tx'], render: () => null },
}));
vi.mock('@/modules/governance/components/dreps/MatchPanel.vue', () => ({
  default: { name: 'MatchPanel', props: ['isOpen', 'statsContext', 'seed'], render: () => null },
}));
vi.mock('@/shared/utils/pendingDelegation', () => ({
  onPendingDRepDelegation: () => () => undefined,
  takePendingDRepDelegation: async () => null,
}));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import DRepDirectory from './DRepDirectory.vue';
import { toCip129 } from '@/shared/utils/drepId';

/** 56 hex chars: `drepStats` keys a row on the credential, not the label. */
const credential = (name: string): string =>
  name.charCodeAt(0).toString(16).padStart(2, '0').repeat(28);

/** The real CIP-129 form, so `sameDRep` can match on credential as it does live. */
const drepId = (name: string): string => toCip129(credential(name)) as string;

/** A DRep the endpoint could really return. Power is a decimal STRING. */
function drep(
  name: string,
  over: { power?: string; delegators?: number; votes?: number; rationale?: number } = {},
) {
  const votes = over.votes ?? 4;
  const withRationale = over.rationale ?? votes;
  return {
    hex: credential(name),
    drep_id: drepId(name),
    display_name: name,
    active: true,
    registered: true,
    amount: over.power ?? '1000000',
    votes: Array.from({ length: votes }, (_, i) => ({
      proposal_id: `p${i}`,
      vote: 'Yes',
      block_time: 1_700_000_000 + i,
      meta_url: i < withRationale ? 'https://example.test/r.json' : null,
    })),
    delegators: Array.from({ length: over.delegators ?? 1 }, (_, i) => ({ stake_address: `stake${i}` })),
  };
}

function mountPage(): Wrapper<Vue> {
  return mount(DRepDirectory, {
    mocks: { $t, $route: { query: {} } },
    stubs: {
      'v-icon': true,
      'v-avatar': true,
      'v-img': true,
      'v-text-field': true,
      'v-skeleton-loader': true,
      'v-pagination': true,
      AsOf: true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Vue.nextTick();
  }
}

let wrapper: Wrapper<Vue> | null = null;

/** The rendered order, by display name. */
function renderedNames(w: Wrapper<Vue>): string[] {
  return w.findAll('.drep-directory__name').wrappers.map(n => n.text());
}

/** One sortable column header, by its label key. */
function header(w: Wrapper<Vue>, labelKey: string): Wrapper<Vue> {
  const found = w
    .findAll('.drep-directory__sort')
    .wrappers.find(button => button.text().startsWith(labelKey));
  if (!found) throw new Error(`no sortable header for ${labelKey}`);
  return found as Wrapper<Vue>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.wallet.account = { drep_id: null };
  h.getDRepsPaginated.mockResolvedValue({
    items: [
      // Deliberately arriving worst-participation-first, and with the biggest
      // holder last, so neither the API order nor power can pass for the sort.
      drep('quiet', { power: '90071992547409920', votes: 1, rationale: 0, delegators: 900 }),
      drep('steady', { power: '2000000', votes: 4, rationale: 4, delegators: 12 }),
    ],
    meta: { total_items: 2, total_pages: 1 },
  });
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
});

describe('DRepDirectory: the header is the sort control', () => {
  it('renders a real button for every sortable column and no sort chip row', async () => {
    wrapper = mountPage();
    await settle();

    // The active header carries a direction glyph; strip it to compare labels.
    const labels = wrapper
      .findAll('.drep-directory__sort')
      .wrappers.map(b => b.text().replace(/[↑↓]/g, '').trim());
    expect(labels).toContain('governance.colParticipation');
    expect(labels).toContain('governance.colRationale');
    expect(labels).toContain('governance.delegators');
    expect(labels).toContain('governance.lastVote');
    expect(labels).toContain('governance.votingPower');
    // Every one of them is a <button>, not a div wearing a click handler.
    for (const button of wrapper.findAll('.drep-directory__sort').wrappers) {
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.attributes('type')).toBe('button');
    }
    // The chip row is gone: the headers replaced it, they did not join it.
    expect(wrapper.find('.drep-directory__sort-label').exists()).toBe(false);
  });

  it('arrives sorted by participation, descending, and says so', async () => {
    wrapper = mountPage();
    await settle();

    expect(renderedNames(wrapper)).toEqual(['steady', 'quiet']);
    const participation = wrapper
      .findAll('[role="columnheader"]')
      .wrappers.find(cell => cell.text().startsWith('governance.colParticipation'));
    expect(participation?.attributes('aria-sort')).toBe('descending');
  });

  it('never arrives sorted by voting power', async () => {
    wrapper = mountPage();
    await settle();

    // `quiet` holds 45 000× more stake than `steady` and is still second.
    expect(renderedNames(wrapper)[0]).toBe('steady');
    const power = wrapper
      .findAll('[role="columnheader"]')
      .wrappers.find(cell => cell.text().startsWith('governance.votingPower'));
    expect(power?.attributes('aria-sort')).toBe('none');
  });

  it('toggles direction when the active header is clicked again', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.colParticipation').trigger('click');
    await Vue.nextTick();
    expect(renderedNames(wrapper)).toEqual(['quiet', 'steady']);

    await header(wrapper, 'governance.colParticipation').trigger('click');
    await Vue.nextTick();
    expect(renderedNames(wrapper)).toEqual(['steady', 'quiet']);
  });

  it('takes over at descending when another header is clicked', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.votingPower').trigger('click');
    await Vue.nextTick();

    expect(renderedNames(wrapper)).toEqual(['quiet', 'steady']);
    const cells = wrapper.findAll('[role="columnheader"]').wrappers;
    expect(cells.find(c => c.text().startsWith('governance.votingPower'))?.attributes('aria-sort')).toBe(
      'descending',
    );
    expect(
      cells.find(c => c.text().startsWith('governance.colParticipation'))?.attributes('aria-sort'),
    ).toBe('none');
  });
});

describe('DRepDirectory: the row action', () => {
  it('delegates to the row the button sits on, not to the first row', async () => {
    wrapper = mountPage();
    await settle();

    // Second row after the default sort is `quiet`.
    const rows = wrapper.findAll('.drep-directory__row').wrappers;
    expect(rows).toHaveLength(2);
    const secondAction = rows[1].find('.drep-directory__col-action button');
    await secondAction.trigger('click');
    await settle();

    expect(h.delegateToDRep).toHaveBeenCalledTimes(1);
    expect(h.delegateToDRep.mock.calls[0][0]).toMatchObject({ id: drepId('quiet'), name: 'quiet' });
  });

  it('follows the row when the order changes', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.votingPower').trigger('click');
    await Vue.nextTick();

    // `quiet` is now FIRST. The same position must now delegate to it.
    const rows = wrapper.findAll('.drep-directory__row').wrappers;
    await rows[0].find('.drep-directory__col-action button').trigger('click');
    await settle();

    expect(h.delegateToDRep.mock.calls[0][0]).toMatchObject({ id: drepId('quiet') });
  });

  it('puts the delegate control in its own action cell, outside the data columns', async () => {
    wrapper = mountPage();
    await settle();

    const row = wrapper.findAll('.drep-directory__row').wrappers[0];
    const action = row.find('.drep-directory__col-action');
    expect(action.exists()).toBe(true);
    expect(action.find('button').exists()).toBe(true);
    // The power cell carries the figure only — the CTA is not inside it.
    expect(row.find('.drep-directory__col-power').find('button').exists()).toBe(false);
  });

  it('reads Delegated and is disabled on the DRep this wallet already uses', async () => {
    h.wallet.account = { drep_id: drepId('steady') };
    wrapper = mountPage();
    await settle();

    const first = wrapper.findAll('.drep-directory__row').wrappers[0];
    expect(first.find('.drep-directory__name').text()).toBe('steady');
    const button = first.find('.drep-directory__col-action button');
    expect(button.text()).toBe('governance.delegated');
    expect(button.attributes('disabled')).toBeTruthy();
  });
});

describe('DRepDirectory: the match CTA', () => {
  it('stands on its own line with its own prompt, not inside the search row', async () => {
    wrapper = mountPage();
    await settle();

    const match = wrapper.find('.drep-directory__match');
    expect(match.exists()).toBe(true);
    expect(match.text()).toContain('governance.matchPrompt');
    expect(match.text()).toContain('governance.findMatch');
    // The search field is in the header, the CTA is not.
    expect(wrapper.find('.drep-directory__header').find('.drep-directory__match').exists()).toBe(false);
  });
});
