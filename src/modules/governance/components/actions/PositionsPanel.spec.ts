// The product complaint this panel answers was "just a list of drep hashes".
// What is pinned below is the part that must not regress into a wrong CLAIM:
// the four your-DRep states, absent optional fields rendering as nothing rather
// than as a blank or a zero, and a capped list saying so out loud.
//
// The Vuetify layer is stubbed; GButton / EmptyState / ErrorState / VoteRow are
// `<script setup>` imports that Vue 2.7 resolves lexically, so they render for
// real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const getDRepsPaginated = vi.fn();
vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => getDRepsPaginated(...args) },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import PositionsPanel from './PositionsPanel.vue';
import { resetDRepNameIndex } from './drepNames';
import { toCip129 } from '@/shared/utils/drepId';
import type { GovVote } from '@/api/governance.types';

/** Echoes params so a wrong interpolated number cannot hide inside the key. */
const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const CRED_A = 'aa'.repeat(28);
const CRED_B = 'bb'.repeat(28);
const DREP_A = toCip129(CRED_A) as string;
const DREP_B = toCip129(CRED_B) as string;

function vote(over: Partial<GovVote> = {}): GovVote {
  return { voterRole: 'DRep', voterHash: CRED_A, drepId: DREP_A, vote: 'Yes', txHash: null, ...over };
}

function mountPanel(props: Record<string, unknown> = {}): Wrapper<Vue> {
  return mount(PositionsPanel, {
    mocks: { $t },
    propsData: { votes: [vote()], total: 1, chain: 'Cardano', network: 'Mainnet', ...props },
    stubs: {
      'v-icon': true,
      'v-chip': true,
      'v-chip-group': true,
      'v-text-field': true,
      'v-skeleton-loader': true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/** Let the mounted panel's name lookup settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Vue.nextTick();
  }
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetDRepNameIndex();
  getDRepsPaginated.mockResolvedValue({ items: [], meta: { page: 1, total_items: 0, per_page: 500, total_pages: 1 } });
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
});

describe('PositionsPanel summary', () => {
  it('counts voters and says out loud that these are not the tally', async () => {
    wrapper = mountPanel({
      votes: [vote(), vote({ drepId: DREP_B, vote: 'No' }), vote({ drepId: null, voterRole: 'SPO', vote: 'Abstain' })],
      total: 3,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsTitle');
    // The honesty line that keeps head counts from being read as stake weight.
    expect(html).toContain('governance.positionsCountsNote');
    // No percentage and no tally bar on this tab.
    expect(html).not.toContain('tally-bar');
  });

  it('offers no rationale affordance at all when the projection carries none', async () => {
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const html = wrapper.html();
    expect(html).not.toContain('governance.rationaleCoverage');
    expect(html).not.toContain('governance.readWhy');
    // An absent field is silent — never "0 of 2 carry a rationale".
    expect(html).not.toContain('governance.rationaleExternalNote');
  });

  it('surfaces the rationale count and the external-fetch note once rationales exist', async () => {
    wrapper = mountPanel({
      votes: [vote({ rationaleUrl: 'https://example.test/why.json' }), vote({ drepId: DREP_B })],
      total: 2,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.rationaleCoverage:{"n":1,"total":2}');
    expect(html).toContain('governance.rationaleExternalNote');
  });

  it('states the cap instead of silently showing a prefix', async () => {
    wrapper = mountPanel({ votes: [vote()], total: 238, truncated: true });
    await settle();

    expect(wrapper.html()).toContain('governance.positionsCapped:{"n":1,"total":238}');
  });
});

describe('PositionsPanel your-DRep callout', () => {
  it('shows the position when the delegated DRep is on the list', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_A, vote: 'Yes' })],
      total: 1,
      // Deliberately the raw credential: the wallet holds one id form and the
      // vote row carries another, and they must still match.
      identity: { drepId: CRED_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourDRepPosition');
    expect(html).toContain('governance.yourStakeFollowed');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('says the DRep has not voted, and what that costs', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 1,
      identity: { drepId: DREP_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourDRepNotVoted');
    expect(html).toContain('governance.uncastCountsAgainst');
  });

  it('refuses to claim "has not voted" from a truncated list', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 238,
      truncated: true,
      identity: { drepId: DREP_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionUnknown');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('reads as first person when the wallet votes as its own DRep', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 1,
      identity: { drepId: DREP_A, kind: 'self' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourPosition');
    expect(html).toContain('governance.youHaventVoted');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('calls a keyword delegation a standing position, not a missing vote', async () => {
    wrapper = mountPanel({
      votes: [vote()],
      total: 1,
      identity: { drepId: 'drep_always_abstain', kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.keywordNoPosition');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('renders one plain line, not an empty box, when nothing here is the user\'s', async () => {
    wrapper = mountPanel({ votes: [vote()], total: 1, identity: null });
    await settle();

    expect(wrapper.html()).toContain('governance.noDelegationNoPosition');
    expect(wrapper.find('.your-position').exists()).toBe(false);
  });
});

describe('PositionsPanel rows', () => {
  it('renders a date only where a block time actually arrived', async () => {
    wrapper = mountPanel({
      votes: [vote({ votedAt: 1787463005 }), vote({ drepId: DREP_B })],
      total: 2,
    });
    await settle();

    // One row has a date cell; the undated row has no cell at all rather than a
    // dash or an epoch-0 date.
    expect(wrapper.findAll('.vote-row__when')).toHaveLength(1);
    expect(wrapper.html()).not.toContain('1970');
  });

  it('marks a script voter only on an explicit true', async () => {
    wrapper = mountPanel({
      votes: [vote({ hasScript: true }), vote({ drepId: DREP_B, hasScript: null })],
      total: 2,
    });
    await settle();

    expect(wrapper.html().match(/governance\.scriptVoter\b/g) ?? []).toHaveLength(1);
  });

  it('shows a published name and keeps the id, falling back to the id alone', async () => {
    getDRepsPaginated.mockResolvedValue({
      items: [{ drep_id: DREP_A, metadata: { meta_json: { body: { givenName: 'CryptoCrow' } } } }],
      meta: { page: 1, total_items: 1, per_page: 500, total_pages: 1 },
    });
    wrapper = mountPanel({ votes: [vote({ drepId: DREP_A }), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const rows = wrapper.findAll('.vote-row');
    expect(rows.at(0).text()).toContain('CryptoCrow');
    // The named row keeps its id on the second line...
    expect(rows.at(0).find('.vote-row__id').exists()).toBe(true);
    // ...and the unnamed one is the truncated id alone, never a placeholder
    // identity and never a second name line standing empty.
    expect(rows.at(1).find('.vote-row__id').exists()).toBe(false);
    expect(rows.at(1).find('.vote-row__name').text()).toMatch(/^drep1.*…?.*$/);
    expect(rows.at(1).text()).not.toContain('CryptoCrow');
    // One directory request for the whole list, never one per row.
    expect(getDRepsPaginated).toHaveBeenCalledTimes(1);
  });

  it('still renders every row when the name lookup fails outright', async () => {
    getDRepsPaginated.mockRejectedValue(new Error('directory down'));
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    expect(wrapper.findAll('.vote-row')).toHaveLength(2);
  });
});

describe('PositionsPanel states', () => {
  it('separates a failed lookup from an action nobody voted on', async () => {
    wrapper = mountPanel({ votes: [], total: null, error: 'upstream down' });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsLoadFailed');
    expect(html).not.toContain('governance.noVotesYet');
  });

  it('invites the reader back when an open action has no positions yet', async () => {
    wrapper = mountPanel({ votes: [], total: 0, actionOpen: true });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.noVotesYet');
    expect(html).toContain('governance.noVotesYetOpen');
  });

  it('says nothing about "still open" once the action has closed', async () => {
    wrapper = mountPanel({ votes: [], total: 0, actionOpen: false });
    await settle();

    expect(wrapper.html()).not.toContain('governance.noVotesYetOpen');
  });

  it('hides the filter chrome on a list too short to need it', async () => {
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    expect(wrapper.find('.positions__controls').exists()).toBe(false);
  });

  it('offers the controls once the list is long enough to search', async () => {
    const votes = Array.from({ length: 20 }, (_, i) =>
      vote({ drepId: toCip129(String(i).padStart(2, '0').repeat(28)) }),
    );
    wrapper = mountPanel({ votes, total: 20 });
    await settle();

    expect(wrapper.find('.positions__controls').exists()).toBe(true);
    expect(wrapper.html()).toContain('governance.showingPositions:{"shown":20,"total":20}');
  });

  it('reports only what it is showing when upstream does not count', async () => {
    wrapper = mountPanel({ votes: [vote()], total: null });
    await settle();

    expect(wrapper.html()).toContain('governance.showingPositionsPartial:{"shown":1}');
  });

  it('states the neutrality promise about ordering', async () => {
    wrapper = mountPanel();
    await settle();

    expect(wrapper.html()).toContain('governance.positionsNeutrality');
    expect(wrapper.html()).toContain('governance.positionsLatestOnly');
  });
});
