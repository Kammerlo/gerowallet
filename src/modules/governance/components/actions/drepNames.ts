/**
 * A credential -> published-name index for the positions explorer.
 *
 * The positions tab shows hundreds of voters, and a bech32 id tells the reader
 * nothing. Names come from the DRep register gero-backend already serves.
 *
 * ONE WALK, TWO SURFACES
 * ----------------------
 * The rows come from `drepRegister.ts` — the same load the DRep directory needs
 * before it can order its client-computed columns. This module used to walk
 * `/api/dreps` itself, so a session that opened both surfaces fetched the whole
 * register twice: 10.74 MB gzipped and 1,682 DReps per walk, measured on mainnet
 * 2026-08-24. Whichever surface asks first now pays, and the other is free while
 * the register is cached. The register retains every field this index reads
 * (`drep_id`, and the metadata blob `drepDisplayName` and `imageSourceOf` look
 * inside), so sharing costs neither a second request nor a second projection.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never calls `getDRepById` per row. That endpoint ships the DRep's
 *    delegators and votes with it (~240 KB each, measured), so a 238-row tab
 *    would be tens of megabytes. There is no batch-by-id endpoint either (the
 *    directory's `search` takes exactly one id; comma- and space-separated
 *    lists 404), which is what rules out the other obvious design: resolving
 *    only the rows on screen would be one request PER ROW, the same N+1 storm.
 *  - It never invents an identity. About one DRep in five publishes a name, so
 *    most rows resolve to nothing, and a truncated id is the honest render.
 *
 * The index is keyed on the 28-byte CREDENTIAL, never on the id string. The
 * register and the votes feed both happen to return CIP-129 today, which is
 * exactly the trap: if production ever projects CIP-105, a string-keyed map
 * would return zero names silently, with no error to notice.
 *
 * WHAT SHARING ONE CACHE HAD TO RECONCILE
 * ---------------------------------------
 *  - THE SEARCH KEY. `loadDRepRegister` keys on chain, network AND search term,
 *    because the server filters before it orders. This asks for the empty term
 *    explicitly, so a directory left on "cardano" can never have its 466
 *    matching rows served here as though they were the register: differing keys
 *    make that a cache MISS, never a quietly smaller answer. The miss costs one
 *    walk the searched directory cannot share — which is what the unshared code
 *    paid on every load anyway.
 *  - THE LIFETIME. The register expires after five minutes; this index does not.
 *    What is memoised below is the DERIVED map — credential to name and avatar
 *    URI — and never the records it was built from, so the register can expire
 *    and release its ~34 MB with the names still in hand. The contract the
 *    positions tab was written against therefore stands: at most one walk per
 *    chain/network per session on ITS account.
 *  - THE BUDGET. This walk used to allow eight pages against the register's six,
 *    so sharing at six would have cost the name index two pages' worth of rows
 *    wherever the server clamps its page size — a silent shrink. The register's
 *    budget moved up to eight instead; see `MAX_REGISTER_PAGES`.
 *
 * A failure still costs the names and nothing else: it resolves EMPTY, every row
 * renders its id, and the memo is dropped so a later mount can pick the register
 * up once it loads.
 */

import { loadDRepRegister, resetDRepRegister } from '@/modules/governance/views/drepRegister';
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

const EMPTY: DRepNameIndex = new Map();

/** Derived indexes, one per chain/network, for the life of the session. */
const cache = new Map<string, Promise<DRepNameIndex>>();

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
 * The name index for one chain/network, derived at most once per session.
 *
 * A failure resolves to an EMPTY index rather than rejecting: names are a
 * courtesy on this surface, and losing them must cost nothing but the names.
 */
export function loadDRepNameIndex(chain: string, network: string): Promise<DRepNameIndex> {
  const key = `${chain}:${network}`;
  const existing = cache.get(key);
  if (existing) return existing;

  // The empty search term, stated rather than defaulted: it is the whole reason
  // a filtered directory cannot leak its 466 rows into this index.
  const derived: Promise<DRepNameIndex> = loadDRepRegister(chain, network, '')
    .then(register => (register.records.length ? indexDRepRecords(register.records) : EMPTY))
    .catch(() => EMPTY)
    .then(index => {
      // Nothing was learned, so nothing is worth keeping: drop the memo and let
      // a later mount ask again. The register's own five-minute TTL is what
      // bounds the retry — a failed walk stays cached THERE, so asking again
      // costs a cache read rather than another 10.74 MB.
      if (!index.size) cache.delete(key);
      return index;
    });

  cache.set(key, derived);
  return derived;
}

/**
 * Test seam.
 *
 * Clears the register too. The index is a projection OF the register, so
 * dropping one without the other leaves the projection's source stale — which
 * on the way in reads as "the reset did nothing".
 */
export function resetDRepNameIndex(): void {
  cache.clear();
  resetDRepRegister();
}
