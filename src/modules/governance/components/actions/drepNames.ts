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
import { drepDisplayName } from '@/shared/utils/drepView';
import { toInAppUrl } from '@/modules/governance/utils/govAnchor';

export interface DRepName {
  name: string | null;
  /**
   * The avatar URI exactly as the DRep published it, `ipfs://` included.
   * `DRepAvatar` is what turns it into something the page can load.
   */
  image?: string;
}

export type DRepNameIndex = ReadonlyMap<string, DRepName>;

/** Rows ASKED FOR per directory request. What the server actually returns is its call. */
export const DIRECTORY_PAGE_SIZE = 500;

/**
 * Pages the index may cost.
 *
 * One page is NOT the whole register: mainnet passed 1,682 registered DReps,
 * so a single page left most voters unresolved and the rows fell back to the
 * hex ids this index exists to replace.
 *
 * What the cap buys in DREPS is not something this file can state. Page size is
 * the server's decision — nothing here evidences that it honours `per_page=500`
 * rather than clamping to a maximum of its own — so the only honest unit is the
 * request budget: at most eight directory calls per session per chain/network,
 * whatever a page turns out to hold.
 *
 * The walk does not assume the ask was honoured either. It prefers the server's
 * own `meta.total_pages`, and where only `total_items` comes back it divides by
 * the rows page 1 ACTUALLY RETURNED, not by what was requested — see
 * `pageCount`. A server that clamps to 100 rows is then walked as 17 pages and
 * stopped by the cap, instead of being read as 4 pages and abandoned early with
 * most names unresolved. Either way the cost is the same bounded number of
 * requests, and every unresolved row still renders its id.
 */
export const MAX_DIRECTORY_PAGES = 8;

const EMPTY: DRepNameIndex = new Map();

const inFlight = new Map<string, Promise<DRepNameIndex>>();

/**
 * The avatar URI a DRep published, kept in the form they wrote it.
 *
 * Deliberately NOT `drepImageUrl()` from `drepView`: that runs the value through
 * `safeExternalHref`, which allows http(s) only — so every `ipfs://` avatar was
 * dropped HERE, before `DRepAvatar` could map it onto the backend proxy, and
 * those rows fell back to the generic glyph even though the DRep had published a
 * picture. About half of mainnet's avatars are `ipfs://` (see `govAnchor.ts`).
 *
 * The value is still scheme-checked, by the SAME shared mapping the avatar uses:
 * a URI `toInAppUrl` cannot turn into something loadable is not stored at all.
 * What is stored is the raw URI, so `DRepAvatar` remains the single place that
 * maps one — this adds no second mapping of its own.
 */
function imageSourceOf(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const meta = (record as { metadata?: { meta_json?: { body?: Record<string, unknown> | null } | null } | null })
    .metadata;
  const image = meta?.meta_json?.body?.['image'];
  if (!image || typeof image !== 'object') return undefined;
  const raw = (image as Record<string, unknown>)['contentUrl'];
  if (typeof raw !== 'string') return undefined;
  const uri = raw.trim();
  return uri && toInAppUrl(uri) ? uri : undefined;
}

/** Build the index from records already in hand. Records with no name are still indexed. */
export function indexDRepRecords(records: unknown[]): Map<string, DRepName> {
  const index = new Map<string, DRepName>();
  for (const record of records ?? []) {
    const id = (record as { drep_id?: unknown })?.drep_id;
    const credentialHex = parseDRepId(typeof id === 'string' ? id : null)?.credentialHex;
    if (!credentialHex) continue;
    index.set(credentialHex, { name: drepDisplayName(record), image: imageSourceOf(record) });
  }
  return index;
}

/**
 * How many pages the register actually has, from whichever count the server sent.
 *
 * `stride` is the number of rows page 1 came back with, NOT `DIRECTORY_PAGE_SIZE`.
 * Dividing `total_items` by what was asked for would re-import the assumption
 * this file disclaims: a server that clamped a 1,682-row register to 100 rows a
 * page would compute 4 pages, and the walk would stop with most names
 * unresolved and nothing to say it had. The rows in hand are evidence; the
 * request parameter is not.
 */
function pageCount(meta: unknown, stride: number): number {
  const counts = meta as { total_pages?: unknown; total_items?: unknown } | null | undefined;
  if (typeof counts?.total_pages === 'number' && Number.isFinite(counts.total_pages)) {
    return Math.max(1, Math.floor(counts.total_pages));
  }
  if (typeof counts?.total_items === 'number' && Number.isFinite(counts.total_items)) {
    // `stride` is floored at 1: page 1 returned rows or the walk already ended,
    // and a zero would make this Infinity. The cap bounds the result regardless.
    return Math.max(1, Math.ceil(counts.total_items / Math.max(1, stride)));
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
    // Page 1 is where the server tells us, by what it sent, how wide a page is.
    if (page === 1) pages = pageCount(response?.meta, items.length);
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
