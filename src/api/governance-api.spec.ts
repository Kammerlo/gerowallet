import { describe, it, expect, vi, beforeEach } from 'vitest';

const TX_HASH = '941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d';

const EMPTY_PAGE = { items: [], page: 1, pageSize: 50, total: 0 };

async function loadApi() {
  const mod = await import('./governance-api');
  return { api: mod.default, instance: mod.governanceAxiosInstance };
}

describe('governance-api', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const { instance } = await loadApi();
    expect(instance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('wires the precision-safe transform — BigInteger stake figures survive as strings', async () => {
    const { instance } = await loadApi();
    const transform = instance.defaults.transformResponse as Array<(data: unknown) => unknown>;
    expect(Array.isArray(transform)).toBe(true);
    const out = transform[0]('{"yesVotePower":25000000000000001}') as { yesVotePower: unknown };
    expect(out.yesVotePower).toBe('25000000000000001');
  });

  describe('listProposals', () => {
    it('sends the cardano-mainnet slug, not the bare enum', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);
      await api.listProposals({ network: 'Mainnet', page: 1, pageSize: 50 });
      expect(get).toHaveBeenCalledWith('/api/governance/proposals', {
        params: { network: 'cardano-mainnet', page: 1, pageSize: 50 },
      });
    });

    it('omits undefined filters rather than sending them as empty', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);
      await api.listProposals({ network: 'Preprod' });
      const params = (get.mock.calls[0][1] as { params: Record<string, unknown> }).params;
      expect(params).not.toHaveProperty('type');
      expect(params).not.toHaveProperty('status');
      expect(params['network']).toBe('cardano-preprod');
    });
  });

  describe('getProposal', () => {
    it('splits the gov action id into two path segments — no # ever leaves the client', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      await api.getProposal(`${TX_HASH}#0`, 'Mainnet');
      expect(get).toHaveBeenCalledWith(`/api/governance/proposals/${TX_HASH}/0`, {
        params: { network: 'cardano-mainnet' },
      });
    });

    it('accepts the bech32 form of the same id', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      // bech32.encode('gov_action', toWords(TX_HASH bytes + index byte 0)) — the CIP-129 form of `${TX_HASH}#0`.
      await api.getProposal('gov_action1js2s9v92zpxg2rge0y3jt9z9nt2mu4da0vvtv2zmh23j64txyy7sqtmennd', 'Mainnet');
      const path = get.mock.calls[0][0];
      expect(path).toBe(`/api/governance/proposals/${TX_HASH}/0`);
    });

    it('rejects an unparseable id without making a request', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get');
      await expect(api.getProposal('not-an-id', 'Mainnet')).rejects.toThrow(/governance action id/i);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getVotingSummary', () => {
    it('targets the voting-summary sub-resource', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      await api.getVotingSummary(`${TX_HASH}#0`, 'Preprod');
      expect(get).toHaveBeenCalledWith(`/api/governance/proposals/${TX_HASH}/0/voting-summary`, {
        params: { network: 'cardano-preprod' },
      });
    });
  });
});
