import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: vi.fn(),
    getProposal: vi.fn(),
    getVotingSummary: vi.fn(),
    getProposalVotes: vi.fn(),
  },
}));

import governanceApi from '@/api/governance-api';
import store from '@/stores/governanceActionsStore';

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
});

describe('loadActions', () => {
  it('stores the page and clears loading', async () => {
    vi.mocked(governanceApi.listProposals).mockResolvedValue({
      items: [{ govActionId: 'a#0', type: 'InfoAction' } as never],
      page: 1,
      pageSize: 50,
      total: 1,
    });

    await store.loadActions('Preprod');

    expect(store.state.actions).toHaveLength(1);
    expect(store.state.loading).toBe(false);
    expect(store.state.error).toBeNull();
  });

  it('records an error message and does not throw', async () => {
    vi.mocked(governanceApi.listProposals).mockRejectedValue(new Error('upstream down'));

    await expect(store.loadActions('Preprod')).resolves.toBeUndefined();

    expect(store.state.error).toBe('upstream down');
    expect(store.state.loading).toBe(false);
    expect(store.state.actions).toEqual([]);
  });

  it('passes the type and status filters through', async () => {
    vi.mocked(governanceApi.listProposals).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    store.setFilters({ type: 'TreasuryWithdrawals', status: 'active' });

    await store.loadActions('Mainnet');

    expect(governanceApi.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TreasuryWithdrawals', status: 'active' }),
    );
  });
});

describe('loadAction', () => {
  it('loads the detail and its voting summary together', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue({ govActionId: 'a#0' } as never);
    vi.mocked(governanceApi.getVotingSummary).mockResolvedValue({ yesVotePower: '1' } as never);

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction?.govActionId).toBe('a#0');
    expect(store.state.currentSummary?.yesVotePower).toBe('1');
    expect(store.state.actionError).toBeNull();
  });

  it('keeps the action when only the summary fails — a tally outage must not blank the page', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue({ govActionId: 'a#0' } as never);
    vi.mocked(governanceApi.getVotingSummary).mockRejectedValue(new Error('no summary'));

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction?.govActionId).toBe('a#0');
    expect(store.state.currentSummary).toBeNull();
    expect(store.state.actionError).toBeNull();
  });

  it('sets actionError when the action itself is missing', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue(null);
    vi.mocked(governanceApi.getVotingSummary).mockResolvedValue(null);

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction).toBeNull();
    expect(store.state.actionError).toBeTruthy();
  });
});
