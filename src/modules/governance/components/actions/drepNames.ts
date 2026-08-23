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
 *    would be tens of megabytes. There is no batch-by-id endpoint either (the
 *    directory's `search` takes exactly one id; comma- and space-separated
 *    lists 404), which is what rules out the other obvious design: resolving
 *    only the rows on screen would be one request PER ROW, the same N+1 storm.
 *    So the directory is walked instead — a handful of wide pages, once per
 *    session, shared by every row.
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

/** Rows per directory request. */
export const DIRECTORY_PAGE_SIZE = 500;

/**
 * Pages the index may cost, i.e. 4,000 DReps.
 *
 * One page is NOT the whole register: mainnet passed 1,682 registered DReps,
 * so a single page left most voters unresolved and the rows fell back to the
 * hex ids this index exists to replace. The walk follows `meta.total_pages`
 * and stops here, so a register that grows past the cap costs a bounded number
 * of requests and simply resolves fewer names.
 */
export const MAX_DIRECTORY_PAGES = 8;

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

/** How many pages the register actually has, from whichever count the server sent. */
function pageCount(meta: unknown): number {
  const counts = meta as { total_pages?: unknown; total_items?: unknown } | null | undefined;
  if (typeof counts?.total_pages === 'number' && Number.isFinite(counts.total_pages)) {
    return Math.max(1, Math.floor(counts.total_pages));
  }
  if (typeof counts?.total_items === 'number' && Number.isFinite(counts.total_items)) {
    return Math.max(1, Math.ceil(counts.total_items / DIRECTORY_PAGE_SIZE));
  }
  // No count at all: one page is all that can be walked towards.
  return 1;
}

/**
 * Walk the directory, page by page, into one credential -> name map.
 *
 * Sequential on purpose: this is a background courtesy for a tab the user is
 * already reading, so it must not fire a burst of wide requests. A page that
 * fails or comes back empty ends the walk and KEEPS what was already indexed —
 * a partial index costs some names, and every unresolved row still renders its
 * id.
 */
async function walkDirectory(chain: string, network: string): Promise<DRepNameIndex> {
  const index = new Map<string, DRepName>();
  let pages = 1;

  for (let page = 1; page <= Math.min(pages, MAX_DIRECTORY_PAGES); page += 1) {
    let response;
    try {
      response = await blockchainApi.getDRepsPaginated({ page, per_page: DIRECTORY_PAGE_SIZE }, chain, network);
    } catch {
      break;
    }
    const items = response?.items ?? [];
    if (!items.length) break;
    for (const [credentialHex, name] of indexDRepRecords(items)) index.set(credentialHex, name);
    if (page === 1) pages = pageCount(response?.meta);
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

  const request = walkDirectory(chain, network).catch(() => EMPTY);

  inFlight.set(key, request);
  return request;
}

/** Test seam. */
export function resetDRepNameIndex(): void {
  inFlight.clear();
}
