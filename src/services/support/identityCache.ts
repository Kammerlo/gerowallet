/**
 * Per-wallet cache of the support-chat identity.
 *
 * <p>The Nexus handshake costs the user a signature prompt, so its result — plus
 * everything Chatwoot hands back afterwards — is cached in the PER-WALLET config
 * table (`wallet-{id}`, key `supportChat.identity`). A wallet therefore signs at
 * most once, ever, and switching wallets switches identities (the whole point of
 * the pseudonymous design: two wallets are two unlinkable support contacts).
 *
 * <p>Nothing cached here is a secret of the wallet: the identifier is a Nexus-side
 * pseudonym of the stake address, and the pubsub token only grants access to that
 * contact's own conversation stream. The stake address itself is never stored.
 */

import { getDb, setWalletConfiguration } from '@/db/wallet-db';
import { debugLog } from '@/utils/debug';

export const SUPPORT_CHAT_IDENTITY_KEY = 'supportChat.identity';

/** Nexus-issued identity (the signed half) plus the Chatwoot handles derived from it. */
export interface SupportChatIdentity {
  /** Opaque `v1:<64 hex>` pseudonym — Chatwoot `identifier`. */
  identifier: string;
  /** Chatwoot `identifier_hash` (HMAC). Required on every contact call. */
  identifierHash: string;
  /** Human-readable pseudonym shown to the agent, e.g. `quiet-dew-4f2a`. */
  displayName: string;
  /** Chatwoot contact `source_id` (set after the contact is created + verified). */
  sourceId?: string;
  /** ActionCable stream credential for this contact. */
  pubsubToken?: string;
  /** Lazily-created conversation. */
  conversationId?: number;
}

/** Just the Nexus-verified half — what the background handshake returns. */
export type SupportChatVerifiedIdentity = Pick<
  SupportChatIdentity,
  'identifier' | 'identifierHash' | 'displayName'
>;

function isIdentity(value: unknown): value is SupportChatIdentity {
  const v = value as SupportChatIdentity | null;
  return !!v && typeof v.identifier === 'string' && typeof v.identifierHash === 'string';
}

/** Read the cached identity for a wallet. Returns null when absent/unreadable. */
export async function loadSupportIdentity(walletId: number): Promise<SupportChatIdentity | null> {
  try {
    const db = await getDb(walletId);
    if (!db) return null;
    const row = await db.table('config').where({ key: SUPPORT_CHAT_IDENTITY_KEY }).first();
    return isIdentity(row?.value) ? (row.value as SupportChatIdentity) : null;
  } catch (error) {
    debugLog('supportChat: identity cache read failed', error);
    return null;
  }
}

/** Persist (or update) the identity for a wallet. Best-effort — never throws. */
export async function saveSupportIdentity(walletId: number, identity: SupportChatIdentity): Promise<void> {
  try {
    await setWalletConfiguration(walletId, SUPPORT_CHAT_IDENTITY_KEY, identity);
  } catch (error) {
    debugLog('supportChat: identity cache write failed', error);
  }
}

/** Drop the identity (rotated/rejected HMAC) so the next send re-runs the handshake. */
export async function clearSupportIdentity(walletId: number): Promise<void> {
  try {
    const db = await getDb(walletId);
    if (!db) return;
    await db.table('config').delete(SUPPORT_CHAT_IDENTITY_KEY);
  } catch (error) {
    debugLog('supportChat: identity cache clear failed', error);
  }
}

/** The cache surface the composable depends on (injectable in tests). */
export interface SupportIdentityCache {
  load(walletId: number): Promise<SupportChatIdentity | null>;
  save(walletId: number, identity: SupportChatIdentity): Promise<void>;
  clear(walletId: number): Promise<void>;
}

export const supportIdentityCache: SupportIdentityCache = {
  load: loadSupportIdentity,
  save: saveSupportIdentity,
  clear: clearSupportIdentity,
};
