// Two guarantees about the Overview tab's prose and its reference list, both of
// which were broken and both of which are invisible to a unit test of the
// renderer alone, because they only exist where the two meet in the DOM:
//
//  1. An inline `[n]` marker is a CONTROL, not a `#gov-ref-n` link. The
//     extension runs a hash-mode router, so a bare fragment href does not
//     scroll — it overwrites the route in the address bar, and reloading that
//     address hits the catch-all and redirects to the wallet home with the
//     proposal gone.
//  2. The list renders the ORIGINAL reference numbers. A `<ol>` counting 1..n
//     renumbers the survivors, so with reference 1 dropped as unsafe a prose
//     [2] marker points at an entry the reader sees labelled "1.".
//
// Everything with a network call, a router or a heavy child behind it is
// mocked; the prose, the reference list and the click wiring are the subject.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const getProposal = vi.fn();
const getVotingSummary = vi.fn();
const getProposalVotes = vi.fn();

vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: vi.fn(),
    getProposal: (...args: unknown[]) => getProposal(...args),
    getVotingSummary: (...args: unknown[]) => getVotingSummary(...args),
    getProposalVotes: (...args: unknown[]) => getProposalVotes(...args),
  },
}));

vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: vi.fn() } }));

vi.mock('vue-router/composables', () => ({
  useRoute: () => ({ params: { txHash: 'aa'.repeat(32), index: '0' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Every child that would drag a store, an API or a dialog in. Each factory is
// spelled out rather than sharing a helper: vi.mock factories are hoisted above
// every binding in this file, so a shared `stubSfc` would not exist yet.
vi.mock('@/modules/governance/dialogs/CastVoteDialog.vue', () => ({
  default: { name: 'CastVoteDialog', props: ['isOpen', 'actions'], render: () => null },
}));
vi.mock('@/modules/governance/components/actions/PositionsPanel.vue', () => ({
  default: { name: 'PositionsPanel', render: () => null },
}));
vi.mock('@/modules/governance/components/actions/BodyTallyCard.vue', () => ({
  default: { name: 'BodyTallyCard', render: () => null },
}));
vi.mock('@/modules/governance/components/actions/VoteCta.vue', () => ({
  default: { name: 'VoteCta', props: ['action'], render: () => null },
}));
vi.mock('@/modules/governance/components/actions/StatusPill.vue', () => ({
  default: { name: 'StatusPill', props: ['status'], render: () => null },
}));
vi.mock('@/modules/governance/components/actions/AnchorBadge.vue', () => ({
  default: { name: 'AnchorBadge', render: () => null },
}));
vi.mock('@/modules/governance/components/actions/AsOf.vue', () => ({
  default: { name: 'AsOf', props: ['timestamp'], render: () => null },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import ActionDetail from './ActionDetail.vue';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';

const $t = (key: string): string => key;

// Read beside this spec, not via `new URL('./x', import.meta.url)`: the
// happy-dom environment resolves that against the document base and hands back
// an http: URL.
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ActionDetail.vue'), 'utf8');

/** The declaration block of the tally wrapper's rule in the scoped stylesheet. */
function talliesRule(): string {
  const match = /\.action-detail__tallies\s*\{([^}]*)\}/.exec(SOURCE);
  expect(match, 'no CSS rule for .action-detail__tallies').not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/**
 * Reference 1 is `ipfs://`, which the safe-URL guard drops, so only reference 2
 * survives — the exact shape both bugs need to be visible.
 */
function detail(over: Record<string, unknown> = {}) {
  return {
    govActionId: 'gov_action1test#0',
    txHash: 'aa'.repeat(32),
    index: 0,
    type: 'InfoAction',
    status: 'active',
    submittedEpoch: 650,
    expiresEpoch: 660,
    anchorUrl: null,
    title: 'A test action',
    deposit: null,
    govAction: null,
    rawMetadata: {},
    abstractText: 'Backed by [1] and by [2].',
    motivation: null,
    rationale: null,
    references: [
      { uri: 'ipfs://QmDropped', label: 'Dropped as unsafe' },
      { uri: 'https://b.test/paper', label: 'The paper' },
    ],
    authors: null,
    hashValid: null,
    ...over,
  };
}

function mountPage(): Wrapper<Vue> {
  return mount(ActionDetail, {
    attachTo: document.body,
    mocks: { $t },
    stubs: {
      'v-icon': true,
      'v-skeleton-loader': true,
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

beforeEach(() => {
  vi.clearAllMocks();
  governanceActionsStore.reset();
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet' } as never;
  walletStore.keys = null;
  walletStore.account = null as never;
  getProposal.mockResolvedValue(detail());
  getVotingSummary.mockResolvedValue(null);
  getProposalVotes.mockResolvedValue({ items: [], page: 1, pageSize: 200, total: 0 });
  vi.spyOn(NetworkStore, 'getCurrentEpoch').mockReturnValue(650);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('ActionDetail references', () => {
  it('renders the original reference number, not a renumbered 1', async () => {
    wrapper = mountPage();
    await settle();

    const items = wrapper.findAll('.action-detail__reference');
    expect(items).toHaveLength(1);
    // The one survivor is the author's SECOND reference, and says so, so the
    // prose marker and the list label agree.
    expect(items.at(0).attributes('value')).toBe('2');
    expect(items.at(0).attributes('id')).toBe('gov-ref-2');
  });

  it('renders a [n] marker as a button, never as a fragment link', async () => {
    wrapper = mountPage();
    await settle();

    const marker = wrapper.find('.md-ref');
    expect(marker.exists()).toBe(true);
    expect(marker.element.tagName).toBe('BUTTON');
    expect(marker.attributes('data-md-ref')).toBe('2');
    // A hash-mode router would read this as a route, not a fragment.
    expect(wrapper.html()).not.toContain('#gov-ref-2');
  });

  it('leaves the marker of a dropped reference as plain text', async () => {
    wrapper = mountPage();
    await settle();

    // Reference 1 was ipfs:// and never became a link, so [1] must not look
    // pressable — exactly one control in the prose, and it is [2].
    expect(wrapper.findAll('.md-ref')).toHaveLength(1);
    expect(wrapper.find('.g-prose').text()).toContain('[1]');
  });

  it('jumps to the entry on activation without touching the address bar', async () => {
    wrapper = mountPage();
    await settle();

    const before = window.location.hash;
    const target = document.getElementById('gov-ref-2') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    // Dispatched rather than called directly: the listener is DELEGATED to the
    // view root, which is the whole point — the markers live inside `v-html`,
    // where the renderer may not emit an inline handler. A <button> also turns
    // Enter and Space into this same click, with no key handler of our own.
    wrapper.find('.md-ref').element.dispatchEvent(new Event('click', { bubbles: true }));
    await Vue.nextTick();

    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(target.classList.contains('action-detail__reference--jumped')).toBe(true);
    expect(window.location.hash).toBe(before);
  });
});

// The bodies vote in parallel, so they are read in parallel: DReps beside the
// committee rather than stacked down a column. The layout lives in the scoped
// stylesheet, which vitest does not apply in happy-dom, so it is asserted
// against the file — after the DOM has confirmed there are two cards in the
// wrapper to lay out.
describe('ActionDetail body tallies', () => {
  it('puts every voting body in one grid, side by side', async () => {
    // A treasury withdrawal is decided by DReps AND the committee.
    getProposal.mockResolvedValue(detail({ type: 'TreasuryWithdrawals' }));
    wrapper = mountPage();
    await settle();

    const tallies = wrapper.find('.action-detail__tallies');
    expect(tallies.exists()).toBe(true);
    expect(wrapper.findAllComponents({ name: 'BodyTallyCard' })).toHaveLength(2);

    const declarations = talliesRule();
    expect(declarations).toMatch(/display:\s*grid/);
    // auto-fit + a min track: two across where there is room, one column in the
    // side panel and the popup, from the same markup.
    expect(declarations).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(/);
    expect(declarations).not.toMatch(/flex-direction:\s*column/);
  });

  it('keeps the advisory panel instead of a tally grid for an info action', async () => {
    // InfoAction has no threshold and can never ratify, so there is nothing to
    // lay out side by side.
    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.action-detail__tallies').exists()).toBe(false);
    expect(wrapper.find('.action-detail__advisory').exists()).toBe(true);
  });

  it('states the rough expiry day beside the epoch count', async () => {
    wrapper = mountPage();
    await settle();

    // Current epoch 650, expires 660: ten epochs, and a date to go with them.
    expect(wrapper.html()).toContain('governance.epochsRemaining');
    expect(wrapper.html()).toContain('governance.approxExpiryDate');
  });

  it('states no expiry day when the current epoch is unknown', async () => {
    (NetworkStore.getCurrentEpoch as unknown as Mock).mockReturnValue(null);
    wrapper = mountPage();
    await settle();

    expect(wrapper.html()).not.toContain('governance.approxExpiryDate');
    // The epoch the chain published is still a fact and still renders.
    expect(wrapper.html()).toContain('governance.expiresEpochLabel');
  });
});
