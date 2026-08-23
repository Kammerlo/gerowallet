import Vue from 'vue';
import governanceApi from '@/api/governance-api';
import { sameDRep } from '@/shared/utils/drepId';
import { isOpen } from '@/shared/utils/govLifecycle';
import type { GovProposal, GovProposalDetail, GovVote, GovVotingSummary } from '@/api/governance.types';

/**
 * Governance actions (CIP-1694 proposals).
 *
 * Deliberately separate from `governanceStore`, which owns DReps and is fed by
 * gero-backend's own snake_case /api/dreps. These two talk to different
 * services with different response shapes; keeping one store per service stops
 * that difference leaking into components.
 */

/**
 * Whose vote the "awaiting your vote" join is looking for: this wallet's own
 * registered DRep, or the DRep it delegated to. The two read differently in the
 * UI ("You haven't voted" vs "Your DRep hasn't voted"), so the kind travels
 * with the result rather than being re-derived at render time.
 */
export type VoterIdentityKind = 'self' | 'delegated';

export interface VoterIdentity {
  /** Any DRep id form. Matched through `sameDRep`, never by string equality. */
  drepId: string;
  kind: VoterIdentityKind;
}

/**
 * `unavailable` is the one that matters: `/api/governance/*` still 404s in
 * production, and a votes endpoint that is not there yet must read as UNKNOWN,
 * never as "nothing awaits your vote". `partial` means some lookups came back
 * and the count covers only those.
 */
export type YourVotesStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

export interface YourVotesState {
  status: YourVotesStatus;
  identityKind: VoterIdentityKind | null;
  /** govActionId -> the vote this identity cast. Absent means they did not vote. */
  byAction: Record<string, string>;
  /** Open actions the scan covered, after the cap. */
  scanned: number;
  /** Of those, how many actually came back. */
  resolved: number;
}

/**
 * The join is one request per open action, so it is capped rather than run over
 * the whole page. The first screenful of open actions is what the stat strip
 * and the row badges can show anyway.
 */
export const MAX_VOTE_SCAN = 10;

/** Requests in flight at once while scanning. */
const VOTE_SCAN_CONCURRENCY = 4;

/** Vote rows fetched per action. Well past any real action's voter count. */
const VOTE_SCAN_PAGE_SIZE = 200;

export interface GovernanceActionsState {
  actions: GovProposal[];
  page: number;
  pageSize: number;
  total: number | null;
  loading: boolean;
  error: string | null;

  currentAction: GovProposalDetail | null;
  currentSummary: GovVotingSummary | null;
  currentVotes: GovVote[];
  actionLoading: boolean;
  actionError: string | null;

  filters: { type: string | null; status: string | null };

  /** Result of the "has my DRep voted on this yet" join. */
  yourVotes: YourVotesState;

  /** When the currently displayed data was fetched — every cached number is stamped. */
  fetchedAt: number | null;
}

function emptyYourVotes(): YourVotesState {
  return { status: 'idle', identityKind: null, byAction: {}, scanned: 0, resolved: 0 };
}

/**
 * Open actions this identity has not voted on, or `null` when that is not
 * knowable. Null is NOT zero, and callers must render the two differently: an
 * unreachable votes endpoint means "we cannot tell", which is the opposite of
 * "you are all caught up".
 */
export function awaitingVoteCount(yourVotes: YourVotesState): number | null {
  if (yourVotes.status !== 'ready' && yourVotes.status !== 'partial') return null;
  return Math.max(0, yourVotes.resolved - Object.keys(yourVotes.byAction).length);
}

const state = Vue.observable<GovernanceActionsState>({
  actions: [],
  page: 1,
  pageSize: 50,
  total: null,
  loading: false,
  error: null,
  currentAction: null,
  currentSummary: null,
  currentVotes: [],
  actionLoading: false,
  actionError: null,
  filters: { type: null, status: null },
  yourVotes: emptyYourVotes(),
  fetchedAt: null,
});

function message(error: unknown, fallback: string): string {
  return (error as { message?: string })?.message || fallback;
}

const actions = {
  state,

  setFilters(next: Partial<GovernanceActionsState['filters']>): void {
    Object.assign(state.filters, next);
  },

  async loadActions(network: string, page = 1): Promise<void> {
    state.loading = true;
    state.error = null;
    try {
      const result = await governanceApi.listProposals({
        network,
        page,
        pageSize: state.pageSize,
        type: state.filters.type ?? undefined,
        status: state.filters.status ?? undefined,
      });
      state.actions = result.items ?? [];
      state.page = result.page ?? page;
      state.total = result.total ?? null;
      state.fetchedAt = Date.now();
    } catch (error) {
      state.error = message(error, 'Failed to load governance actions');
      state.actions = [];
    } finally {
      state.loading = false;
    }
  },

  /**
   * Load one action plus its tally. The two are fetched together but fail
   * independently: a tally outage leaves the action readable rather than
   * blanking the page.
   */
  async loadAction(govActionId: string, network: string): Promise<void> {
    state.actionLoading = true;
    state.actionError = null;
    state.currentAction = null;
    state.currentSummary = null;
    state.currentVotes = [];

    const [detail, summary] = await Promise.allSettled([
      governanceApi.getProposal(govActionId, network),
      governanceApi.getVotingSummary(govActionId, network),
    ]);

    if (detail.status === 'fulfilled' && detail.value) {
      state.currentAction = detail.value;
    } else {
      state.actionError =
        detail.status === 'rejected'
          ? message(detail.reason, 'Failed to load this governance action')
          : 'Governance action not found';
    }

    state.currentSummary = summary.status === 'fulfilled' ? summary.value : null;
    state.fetchedAt = Date.now();
    state.actionLoading = false;
  },

  /**
   * Join this wallet's DRep identity against the votes cast on each OPEN action
   * currently loaded, so the board can say which ones still await a vote.
   *
   * Deliberately best-effort and capped. This is an N+1 over the action list,
   * one `getProposalVotes` per open action, so it runs over at most
   * `MAX_VOTE_SCAN` actions in small batches. Individual failures are absorbed:
   * what they cost is CERTAINTY, not the page, and that loss is reported
   * through `status` so the UI can show "unknown" rather than a wrong number.
   */
  async loadYourVotes(
    network: string,
    identity: VoterIdentity | null,
    options: { max?: number; concurrency?: number } = {},
  ): Promise<void> {
    const max = options.max ?? MAX_VOTE_SCAN;
    const concurrency = options.concurrency ?? VOTE_SCAN_CONCURRENCY;

    // A watch-only wallet, or one that has delegated to nobody, has no identity
    // to join against. That is not a failure and must not cost a request.
    if (!identity?.drepId) {
      state.yourVotes = emptyYourVotes();
      return;
    }

    const open = state.actions.filter(action => isOpen(action.status)).slice(0, max);

    state.yourVotes = {
      status: open.length ? 'loading' : 'ready',
      identityKind: identity.kind,
      byAction: {},
      scanned: open.length,
      resolved: 0,
    };
    if (!open.length) return;

    const byAction: Record<string, string> = {};
    let resolved = 0;

    for (let i = 0; i < open.length; i += concurrency) {
      const batch = open.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(action =>
          governanceApi.getProposalVotes(action.govActionId, network, 1, VOTE_SCAN_PAGE_SIZE),
        ),
      );
      results.forEach((result, j) => {
        if (result.status !== 'fulfilled') return;
        resolved += 1;
        // Match on the credential, never on the display string: the wallet holds
        // one id form and the vote row may carry another.
        const match = (result.value?.items ?? []).find(vote => sameDRep(vote.drepId, identity.drepId));
        if (match) byAction[batch[j].govActionId] = String(match.vote);
      });
    }

    state.yourVotes = {
      status: resolved === 0 ? 'unavailable' : resolved < open.length ? 'partial' : 'ready',
      identityKind: identity.kind,
      byAction,
      scanned: open.length,
      resolved,
    };
  },

  async loadActionVotes(govActionId: string, network: string, page = 1): Promise<void> {
    try {
      const result = await governanceApi.getProposalVotes(govActionId, network, page, 100);
      state.currentVotes = result.items ?? [];
    } catch {
      // Votes are supplementary to the tally — a failure here must not surface
      // as a page-level error.
      state.currentVotes = [];
    }
  },

  reset(): void {
    state.actions = [];
    state.page = 1;
    state.total = null;
    state.loading = false;
    state.error = null;
    state.currentAction = null;
    state.currentSummary = null;
    state.currentVotes = [];
    state.actionLoading = false;
    state.actionError = null;
    state.filters.type = null;
    state.filters.status = null;
    state.yourVotes = emptyYourVotes();
    state.fetchedAt = null;
  },
};

export default actions;
