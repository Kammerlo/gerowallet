import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { bigJsonTransform } from '@/api/bigJson';
import { parseGovActionId } from '@/shared/utils/govActionId';
import type {
  Committee,
  Constitution,
  GovPage,
  GovProposal,
  GovProposalDetail,
  GovVote,
  GovVotingSummary,
} from '@/api/governance.types';

/**
 * Client for Cardano governance actions, served by Nexus through the
 * gero-backend proxy at `<backend>/api/nexus`.
 *
 * SCOPE: this client covers governance ACTIONS, the committee and the
 * constitution only. DReps are NOT here — gero-backend serves those from its
 * own cache via `blockchain-api.ts` (`/api/dreps`, snake_case). Keep the two
 * apart; their response shapes and network-parameter formats both differ.
 *
 * Two conventions this client owns:
 *  1. Nexus wants the chain-prefixed network slug (`cardano-mainnet`), not the
 *     wallet's bare `Mainnet`.
 *  2. A governance action id never leaves here containing a `#`. The proxy
 *     takes the tx hash and index as separate path segments and rebuilds the
 *     `%23` form upstream.
 */

export const governanceAxiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  // Replaces Axios's default JSON.parse so BigInteger stake figures survive.
  transformResponse: bigJsonTransform,
});

/** Map the wallet's Network value to Nexus's slug. Nexus rejects the bare enum. */
function toNexusNetwork(network: string | undefined | null): string {
  const value = String(network ?? '').toLowerCase();
  if (value.includes('preprod')) return 'cardano-preprod';
  if (value.includes('preview')) return 'cardano-preview';
  return 'cardano-mainnet';
}

/** Split a gov action id into the two path segments the proxy expects. */
function idSegments(govActionId: string): { txHash: string; index: number } {
  const parsed = parseGovActionId(govActionId);
  if (!parsed) throw new Error(`Unrecognised governance action id: ${govActionId}`);
  return parsed;
}

/** True for an Axios error whose upstream response was a 404. */
function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export interface ListProposalsParams {
  network: string;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export default {
  async listProposals(params: ListProposalsParams): Promise<GovPage<GovProposal>> {
    const query: Record<string, string | number> = { network: toNexusNetwork(params.network) };
    if (params.type) query['type'] = params.type;
    if (params.status) query['status'] = params.status;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/proposals', { params: query });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  async getProposal(govActionId: string, network: string): Promise<GovProposalDetail | null> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(`/api/governance/proposals/${txHash}/${index}`, {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getProposalVotes(
    govActionId: string,
    network: string,
    page = 1,
    pageSize = 100
  ): Promise<GovPage<GovVote>> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(
        `/api/governance/proposals/${txHash}/${index}/votes`,
        { params: { network: toNexusNetwork(network), page, pageSize } }
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  async getVotingSummary(govActionId: string, network: string): Promise<GovVotingSummary | null> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(
        `/api/governance/proposals/${txHash}/${index}/voting-summary`,
        { params: { network: toNexusNetwork(network) } }
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getCommittee(network: string): Promise<Committee | null> {
    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/committee', {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getConstitution(network: string): Promise<Constitution | null> {
    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/constitution', {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },
};
