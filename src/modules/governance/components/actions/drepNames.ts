/**
 * A credential -> published-name index for the positions explorer.
 *
 * The positions tab shows hundreds of voters, and a bech32 id tells the reader
 * nothing. Names come from the DRep directory gero-backend already serves.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never calls `getDRepById` per row. That endpoint ships the DRep's
 *    delegators and votes with it (~240 KB each, measured), so a 238-row tab
 *    would be tens of megabytes. One wide directory page covers the whole
 *    index instead, and there is no batch-by-id endpoint to use (the directory's
 *    `search` takes exactly one id; comma- and space-separated lists 404).
 *  - It never invents an identity. About one DRep in five publishes a name, so
 *    most rows resolve to nothing, and a truncated id is the honest render.
 *
 * The index is keyed on the 28-byte CREDENTIAL, never on the id string. The
 * directory and the votes feed both happen to return CIP-129 today, which is
 * exactly the trap: if production ever projects CIP-105, a string-keyed map
 * would return zero names silently, with no error to notice.
 */

import blockchainApi from '@/api/blockchain-api';
import { parseDRepId } from '@/shared/utils/drepId';
import { drepDisplayName, drepImageUrl } from '@/shared/utils/drepView';

export interface DRepName {
  name: string | null;
  image?: string;
}

export type DRepNameIndex = ReadonlyMap<string, DRepName>;

/** One directory page covers the whole mainnet register (~1,545 DReps) with room to spare. */
const DIRECTORY_PAGE_SIZE = 500;

const EMPTY: DRepNameIndex = new Map();

const inFlight = new Map<string, Promise<DRepNameIndex>>();

/** Build the index from records already in hand. Records with no name are still indexed. */
export function indexDRepRecords(records: unknown[]): Map<string, DRepName> {
  const index = new Map<string, DRepName>();
  for (const record of records ?? []) {
    const id = (record as { drep_id?: unknown })?.drep_id;
    const credentialHex = parseDRepId(typeof id === 'string' ? id : null)?.credentialHex;
    if (!credentialHex) continue;
    index.set(credentialHex, { name: drepDisplayName(record), image: drepImageUrl(record) });
  }
  return index;
}

/**
 * The name index for one chain/network, fetched at most once per session.
 *
 * A failure resolves to an EMPTY index rather than rejecting: names are a
 * courtesy on this surface, and losing them must cost nothing but the names.
 */
export function loadDRepNameIndex(chain: string, network: string): Promise<DRepNameIndex> {
  const key = `${chain}:${network}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = blockchainApi
    .getDRepsPaginated({ page: 1, per_page: DIRECTORY_PAGE_SIZE }, chain, network)
    .then(response => indexDRepRecords(response?.items ?? []) as DRepNameIndex)
    .catch(() => EMPTY);

  inFlight.set(key, request);
  return request;
}

/** Test seam. */
export function resetDRepNameIndex(): void {
  inFlight.clear();
}
