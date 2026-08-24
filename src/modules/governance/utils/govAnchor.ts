/**
 * Off-chain governance assets: DRep avatars and CIP-136 rationale documents.
 *
 * Both are author-hosted, so both arrive as a URI the wallet did not choose, and
 * roughly a quarter of them are `ipfs://`. Two DIFFERENT URLs come out of the
 * same input here, and conflating them is the bug this module exists to prevent:
 *
 *  - {@link toInAppUrl} is what the extension page itself loads (an `<img>` src,
 *    a `fetch`). An `ipfs://` URI cannot be one, and neither can a public
 *    gateway URL: `ipfs.io`, Pinata and Cloudflare answer cross-origin extension
 *    requests with 403 plus `Cross-Origin-Resource-Policy`, which Chrome blocks
 *    outright (see `shared/utils/ipfs.ts`). That is precisely why so many DRep
 *    avatars render blank today. IPFS is content-addressed, so the same CID
 *    through gero-backend's own `/api/ipfs` proxy returns identical bytes from
 *    an origin the extension is allowed to talk to — and the user's IP never
 *    reaches the gateway.
 *  - {@link toExternalHref} is what a NEW BROWSER TAB opens. No extension CSP
 *    applies there, so an `ipfs://` CID becomes an ordinary public gateway link.
 *
 * Everything is scheme-checked. `javascript:`, `data:` and every other scheme
 * resolve to null rather than being handed to an `<img>` or an `href`.
 */

import { detectCIDVersion, ipfsPathFromGatewayUrl, ipfsProxyUrl } from '@/shared/utils/ipfs';
import { safeExternalHref } from '@/shared/utils/externalLink';

/**
 * The public gateway an `ipfs://` link is opened through OUTSIDE the extension.
 * Only ever used to build an href for a new tab — never as a fetch target.
 */
export const PUBLIC_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * `<cid>[/sub/path]` for anything that names IPFS content, or null.
 *
 * Deliberately tolerant about how the CID is spelled — `ipfs://cid`,
 * `ipfs://ipfs/cid`, `ipfs/cid`, a bare CID, or any of the public gateway
 * spellings — and strict about what counts: the leading segment must PARSE as a
 * real CID. Without that check `https://example.test/ipfs/logo.png` would be
 * re-pointed at the IPFS proxy, which cannot resolve it.
 *
 * Sub-path segments keep their original percent-encoding; `ipfsProxyUrl` needs
 * them that way (see its own doc for why decoding here would corrupt a name
 * containing an encoded slash).
 */
export function ipfsPathOf(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;

  const fromGateway = ipfsPathFromGatewayUrl(value);
  if (fromGateway) return fromGateway;

  const withoutScheme = value.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (detectCIDVersion(segments[0]) === null) return null;
  return segments.join('/');
}

/**
 * A URL the extension page may load itself, or null when there is nothing safe
 * to load. IPFS goes through the backend proxy; http(s) passes through the
 * shared scheme guard unchanged.
 */
export function toInAppUrl(raw: unknown): string | null {
  const path = ipfsPathOf(raw);
  if (path) return ipfsProxyUrl(path);
  return safeExternalHref(raw) ?? null;
}

/**
 * A URL to hand the browser in a new tab, or null. IPFS becomes a public
 * gateway link — the one place that is the right answer, because the tab is not
 * the extension origin and nothing about the wallet is attached to the request.
 */
export function toExternalHref(raw: unknown): string | null {
  const path = ipfsPathOf(raw);
  if (path) return `${PUBLIC_IPFS_GATEWAY}${path}`;
  return safeExternalHref(raw) ?? null;
}
