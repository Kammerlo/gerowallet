/**
 * Fetch a CIP-136 vote rationale and prove it is the document that was voted on.
 *
 * ## What makes this safe to render
 *
 * The anchor on a vote is a PAIR: a URL and a blake2b-256 of the bytes at that
 * URL, both recorded on chain. The URL is author-controlled and its host is not,
 * so bytes that come back are worth nothing on their own — the hash is what ties
 * them to the vote. This module therefore refuses to produce text unless the
 * hash of the RAW BYTES matches, byte for byte, exactly as `cip119.ts` describes
 * for DRep anchors: hash the octets as downloaded, never a re-serialized or
 * canonicalized form.
 *
 * Four failure shapes, kept apart because they mean different things to the
 * reader and the dialog says something different about each:
 *
 *  - `mismatch` — the document at the link is NOT the one that was voted on. The
 *    text is discarded, never rendered. Showing it would let anyone rewrite
 *    their published reasoning after the fact and have the wallet vouch for it.
 *  - `unverifiable` — no on-chain hash reached us, so there is nothing to check
 *    against. Same outcome as a mismatch: link out, render nothing.
 *  - `oversize` — past {@link MAX_RATIONALE_BYTES}. The URL is attacker-chosen,
 *    so the response size is attacker-chosen; the cap is checked against the
 *    declared length AND against what actually arrived.
 *  - `network` — offline, refused, aborted at {@link RATIONALE_TIMEOUT_MS}, or
 *    blocked by the extension's `connect-src` allowlist (an author's own host is
 *    not on it; IPFS anchors go through gero-backend's proxy, which is). All of
 *    those are the same fact to a reader: the wallet could not get the file, and
 *    the browser can.
 *
 * Nothing here touches the DOM and the fetch is injectable, so the whole
 * decision table is testable without a network.
 */

import { anchorHashOfBytes } from '@/shared/utils/cip119';
import { toInAppUrl } from '@/modules/governance/utils/govAnchor';

/** Give up on a third-party host after this long. */
export const RATIONALE_TIMEOUT_MS = 10_000;

/**
 * Hard ceiling on the document. Real rationales are a few kilobytes of prose;
 * this leaves three orders of magnitude of headroom and still bounds what a
 * hostile anchor can make the extension hold in memory and hash.
 */
export const MAX_RATIONALE_BYTES = 512 * 1024;

/** Why no text is being shown. Each maps to its own line of copy. */
export type RationaleFailure = 'mismatch' | 'unverifiable' | 'oversize' | 'network' | 'empty';

/** One labelled block of the document, in the order CIP-136 lists them. */
export interface RationaleSection {
  /** i18n key for the heading, or null for a document with no known structure. */
  labelKey: string | null;
  /** Raw markdown, to be rendered ONLY through `renderMarkdown`. */
  text: string;
}

export type RationaleResult =
  | { status: 'verified'; sections: RationaleSection[]; hash: string }
  | { status: 'failed'; reason: RationaleFailure };

/**
 * CIP-136 body fields worth showing, in reading order, with the heading each
 * gets. `comment` is CIP-100's generic field and comes first because a document
 * that carries one usually carries nothing else.
 */
const SECTION_FIELDS: ReadonlyArray<readonly [string, string | null]> = [
  ['comment', null],
  ['summary', 'dashboard.summary'],
  ['rationaleStatement', 'governance.rationale'],
  ['precedentDiscussion', 'governance.rationalePrecedent'],
  ['counterargumentDiscussion', 'governance.rationaleCounterargument'],
  ['conclusion', 'governance.rationaleConclusion'],
];

/** CIP metadata values are sometimes bare strings, sometimes JSON-LD `{'@value': …}`. */
function cipValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '@value' in (value as object)) {
    const inner = (value as Record<string, unknown>)['@value'];
    return typeof inner === 'string' ? inner.trim() : '';
  }
  return '';
}

/**
 * The prose inside a verified document.
 *
 * A document that does not parse as JSON is still returned as ONE unlabelled
 * section rather than discarded: its bytes hashed correctly, so it is exactly
 * what the voter published, and `renderMarkdown` escapes every byte of it before
 * anything reaches the DOM. Refusing to show a verified document because its
 * shape surprised us would hide the voter's own words.
 */
export function extractRationaleSections(raw: string): RationaleSection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const text = raw.trim();
    return text ? [{ labelKey: null, text }] : [];
  }

  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const inner = root['body'];
  const body = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : root;

  const sections: RationaleSection[] = [];
  for (const [field, labelKey] of SECTION_FIELDS) {
    const text = cipValue(body[field]);
    if (text) sections.push({ labelKey, text });
  }
  return sections;
}

export interface LoadRationaleOptions {
  /** The vote's `meta_url`. http(s) or ipfs. */
  url: unknown;
  /** The vote's `meta_hash` — 64 hex characters, or verification cannot run. */
  hash: unknown;
  /** Injectable for tests. Defaults to the ambient `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

function failed(reason: RationaleFailure): RationaleResult {
  return { status: 'failed', reason };
}

/**
 * Fetch, verify, extract. Never throws: every path returns a result the dialog
 * can render, because a rejected promise here would surface as an unhandled
 * error on a page the user opened by clicking a link.
 */
export async function loadRationale(options: LoadRationaleOptions): Promise<RationaleResult> {
  const target = toInAppUrl(options.url);
  if (!target) return failed('network');

  const expected = String(options.hash ?? '').trim().toLowerCase();
  // Nothing to check against is NOT "probably fine": an unverified document from
  // an author-controlled host is exactly what the hash exists to catch.
  if (!/^[0-9a-f]{64}$/.test(expected)) return failed('unverifiable');

  const maxBytes = options.maxBytes ?? MAX_RATIONALE_BYTES;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return failed('network');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RATIONALE_TIMEOUT_MS);

  try {
    const response = await doFetch(target, {
      signal: controller.signal,
      // No cookies, no cached copy, no redirect the author did not publish.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!response?.ok) return failed('network');

    // Cheap refusal before anything is buffered. A lying Content-Length is
    // caught by the byte check below, so this is an optimisation, not the bound.
    const declared = Number(response.headers?.get?.('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) return failed('oversize');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) return failed('oversize');
    if (bytes.byteLength === 0) return failed('empty');

    // The bytes as downloaded — the only form the on-chain hash is over.
    const hash = anchorHashOfBytes(bytes);
    if (hash !== expected) return failed('mismatch');

    const sections = extractRationaleSections(new TextDecoder('utf-8').decode(bytes));
    if (sections.length === 0) return failed('empty');

    return { status: 'verified', sections, hash };
  } catch {
    // Aborted, offline, CORS, CSP: one fact for the reader either way.
    return failed('network');
  } finally {
    clearTimeout(timer);
  }
}
