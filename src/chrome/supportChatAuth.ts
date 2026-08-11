/**
 * Support-chat identity handshake (background only).
 *
 * <p>Proves control of a wallet to Nexus WITHOUT revealing anything to Chatwoot:
 * Nexus issues a nonce, the wallet CIP-8 (COSE_Sign1) signs the challenge subject
 * with its STAKE key — the same machinery the cross-device wallet-control proof
 * uses (see `services/crossDevice/registerProof.ts` and `walletBg.signData`) — and
 * Nexus returns a pseudonymous Chatwoot identifier + HMAC. The stake address never
 * leaves the wallet↔Nexus leg; the chat itself only ever sees the pseudonym.
 *
 * <p>SECURITY: the wallet must NEVER blind-sign a server-supplied string with its
 * stake key. {@link runSupportChatHandshake} reconstructs the expected subject
 * locally and refuses to sign anything that is not byte-for-byte equal, so a
 * compromised/hostile Nexus cannot harvest a stake-key signature over a payload of
 * its choosing.
 *
 * <p>Runs in the background service worker because that is the only context that
 * can reach the wallet's private keys.
 */

import axios, { type AxiosInstance } from 'axios';
import type { SupportChatVerifiedIdentity } from '@/services/support/identityCache';

export type { SupportChatVerifiedIdentity };

/** Domain-separated challenge subject. Mirrors DEVICE_REGISTER_DOMAIN's shape. */
export const SUPPORT_CHALLENGE_DOMAIN = 'gero-support/v1';
export const SUPPORT_CHALLENGE_PATH = '/api/support/chat/challenge';
export const SUPPORT_VERIFY_PATH = '/api/support/chat/verify';

/**
 * Nexus is reached through gero-backend's proxy (VITE_NEXUS_URL), exactly like
 * every other first-party client (see `api/agent.client.ts`).
 */
export const supportAuthAxiosInstance: AxiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'] || '',
  timeout: 20_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

/** CIP-30 `signData` result: COSE_Sign1 + COSE_Key, both hex. */
export type SupportSignFn = (payloadHex: string) => Promise<{ signature: string; key: string }>;

export interface SupportHandshakeParams {
  /** bech32 reward address (`stake1…`) of the active Cardano wallet. */
  stakeAddress: string;
  sign: SupportSignFn;
}

/** The exact string the stake key signs. Pipe-joined, domain-separated. */
export function buildSupportChallengeSubject(stakeAddress: string, nonce: string): string {
  return `${SUPPORT_CHALLENGE_DOMAIN}|${stakeAddress}|${nonce}`;
}

function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function statusOf(error: unknown): number | undefined {
  const res = (error as { response?: { status?: number } } | null)?.response;
  return typeof res?.status === 'number' ? res.status : undefined;
}

interface ChallengeResponse {
  nonce?: string;
  message?: string;
}

interface VerifyResponse {
  identifier?: string;
  identifierHash?: string;
  displayName?: string;
}

async function requestChallenge(stakeAddress: string): Promise<{ nonce: string; message: string }> {
  const { data } = await supportAuthAxiosInstance.post<ChallengeResponse>(SUPPORT_CHALLENGE_PATH, { stakeAddress });
  const nonce = data?.nonce;
  const message = data?.message;
  if (!nonce || !message) throw new Error('Support challenge response incomplete');
  // Never sign a server-chosen payload: the subject must be exactly what we expect.
  if (message !== buildSupportChallengeSubject(stakeAddress, nonce)) {
    throw new Error('Support challenge subject mismatch — refusing to sign');
  }
  return { nonce, message };
}

async function verify(
  stakeAddress: string,
  nonce: string,
  coseSign1Hex: string,
  coseKeyHex: string,
): Promise<SupportChatVerifiedIdentity> {
  const { data } = await supportAuthAxiosInstance.post<VerifyResponse>(SUPPORT_VERIFY_PATH, {
    stakeAddress,
    nonce,
    coseSign1Hex,
    coseKeyHex,
  });
  if (!data?.identifier || !data?.identifierHash) throw new Error('Support verify response incomplete');
  return {
    identifier: data.identifier,
    identifierHash: data.identifierHash,
    displayName: data.displayName || '',
  };
}

/**
 * Run challenge → sign → verify. A 400 on verify means the nonce expired between
 * the two calls (the user sat on the password prompt), so the whole round is
 * retried ONCE with a fresh nonce. Any other failure — 401 (bad signature), 429
 * (rate limited), network — propagates; the caller must not loop.
 */
export async function runSupportChatHandshake(
  params: SupportHandshakeParams,
): Promise<SupportChatVerifiedIdentity> {
  const { stakeAddress, sign } = params;
  if (!stakeAddress || !stakeAddress.startsWith('stake1')) {
    throw new Error('Support chat requires a Cardano reward address');
  }

  for (let round = 0; round < 2; round++) {
    const { nonce, message } = await requestChallenge(stakeAddress);
    const { signature, key } = await sign(utf8ToHex(message));
    if (!signature || !key) throw new Error('Support challenge signing produced no signature');
    try {
      return await verify(stakeAddress, nonce, signature, String(key));
    } catch (error) {
      const expiredNonce = statusOf(error) === 400 && round === 0;
      if (!expiredNonce) throw error;
    }
  }
  /* istanbul ignore next — the loop either returns or throws */
  throw new Error('Support chat handshake failed');
}
