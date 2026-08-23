import Vue from 'vue';
import governanceApi from '@/api/governance-api';
import type { GovProposal, GovProposalDetail, GovVote, GovVotingSummary } from '@/api/governance.types';

/**
 * Governance actions (CIP-1694 proposals).
 *
 * Deliberately separate from `governanceStore`, which owns DReps and is fed by
 * gero-backend's own snake_case /api/dreps. These two talk to different
 * services with different response shapes; keeping one store per service stops
 * that difference leaking into components.
 */

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

  /** When the currently displayed data was fetched — every cached number is stamped. */
  fetchedAt: number | null;
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
    state.fetchedAt = null;
  },
};

export default actions;
