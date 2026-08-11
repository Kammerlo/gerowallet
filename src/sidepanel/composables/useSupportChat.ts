// src/sidepanel/composables/useSupportChat.ts
//
// Non-custodial live support chat — state machine + orchestration.
//
// Identity is the wallet's stake address, pseudonymized by Nexus: the background
// signs a Nexus-issued challenge with the stake key (CIP-8) exactly once per
// wallet, and Nexus returns a Chatwoot identifier + HMAC + display name. From
// there the side panel talks straight to Chatwoot's public Client API (REST +
// ActionCable). Everything is cached per wallet, so the signature prompt happens
// once, ever.
//
// This module never imports i18n: it only ever exposes an i18n KEY (`errorKey`)
// and lets the UI render it. It also never logs identifiers, tokens, or
// addresses.
//
// Structural model: `useAgentDock.ts` — an injectable factory plus a singleton.

import { computed, ref, watch, type Ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import {
  ChatAuthError,
  chatwootSupportApi,
  type SupportApiMessage,
  type SupportContact,
  type SupportContactIdentity,
} from '@/api/chatwootSupport.client';
import {
  createSupportCable,
  type SupportCable,
  type SupportCableOptions,
  type SupportCableState,
} from '@/services/support/actionCable';
import {
  supportIdentityCache,
  type SupportChatIdentity,
  type SupportChatVerifiedIdentity,
  type SupportIdentityCache,
} from '@/services/support/identityCache';

export type SupportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface SupportMessage {
  /** Chatwoot message id; NEGATIVE for an optimistic local echo not yet confirmed. */
  id: number;
  role: 'user' | 'agent';
  text: string;
  agentName?: string;
  /** epoch ms */
  createdAt: number;
}

export interface SupportChat {
  messages: Ref<SupportMessage[]>;
  /** A send is in flight. */
  busy: Ref<boolean>;
  connectionState: Ref<SupportConnectionState>;
  /** Incoming agent messages since the last markSeen(). */
  unread: Ref<number>;
  /** False when the wallet has no signable stake key (hardware / non-Cardano). */
  isAvailable: Ref<boolean>;
  /** i18n KEY only — the UI renders it. `support.error.unavailable` | `support.error.sendFailed`. */
  errorKey: Ref<string | null>;
  /** Idempotent: load history (only if an identity is cached) and connect the cable. */
  enter(): Promise<void>;
  /** false = not sent (auth cancelled/failed) → the UI keeps the draft. */
  send(text: string): Promise<boolean>;
  markSeen(): void;
}

/** Credentials the background needs to unlock the stake key for the handshake. */
export interface SupportAuthInput {
  /** Spending password (software wallets). */
  password?: string;
  /** Pre-decrypted root key bytes (PRF / PassKey wallets), as a plain array for messaging. */
  privateKeyBytes?: number[];
}

/** The wallet facts the chat needs. Mirrors `walletStore.loggedWallet`. */
export interface SupportWalletSnapshot {
  id: number;
  chain?: string;
  type?: string;
  stakeAddress?: string;
}

/** The Chatwoot surface the composable depends on (injectable for tests). */
export interface SupportChatApi {
  ensureContact(identity: SupportContactIdentity): Promise<SupportContact>;
  createConversation(sourceId: string): Promise<number>;
  listMessages(sourceId: string, conversationId: number): Promise<SupportApiMessage[]>;
  sendMessage(sourceId: string, conversationId: number, content: string): Promise<SupportApiMessage | null>;
}

export interface SupportChatDeps {
  api?: SupportChatApi;
  cache?: SupportIdentityCache;
  createCable?: (options: SupportCableOptions) => SupportCable;
  /** Runs the stake-key handshake in the background. null = could not authenticate. */
  requestIdentity?: (auth: SupportAuthInput) => Promise<SupportChatVerifiedIdentity | null>;
  /**
   * Collects spending auth for the one-time handshake. Resolving null means the
   * user CANCELLED (no error shown); throwing means auth FAILED. The default
   * throws until the dock wires a prompt in — see {@link setSupportAuthPrompt}.
   */
  promptAuth?: () => Promise<SupportAuthInput | null>;
  wallet?: () => SupportWalletSnapshot | null;
}

/**
 * Result of establishing an identity. `cancelled` and `failed` both stop the send,
 * but only `failed` is worth surfacing as an error — see {@link setSupportAuthPrompt}.
 */
type IdentityOutcome =
  | { status: 'ok'; identity: SupportChatIdentity }
  | { status: 'cancelled' }
  | { status: 'failed' };

/**
 * Wallet types whose stake key the BACKGROUND can unlock for the handshake.
 * `Normal` covers both password and PRF/PassKey wallets. Hardware wallets
 * (Ledger/Trezor/Keystone) have no decryptable key here, and MPC `Google` wallets
 * would need the MPC session share path (`resolveSignPrivateKeyBytes`), so both
 * are reported as unavailable rather than failing halfway through a send.
 */
const SIGNABLE_WALLET_TYPES = new Set(['Normal', 'normal']);

/** Ask the background to run challenge → CIP-8 sign → verify. */
async function backgroundRequestIdentity(auth: SupportAuthInput): Promise<SupportChatVerifiedIdentity | null> {
  try {
    const response = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUPPORT_CHAT_AUTH,
      data: { password: auth.password, privateKeyBytes: auth.privateKeyBytes },
    })) as { data?: { success?: boolean; identity?: SupportChatVerifiedIdentity } } | null;
    const result = response?.data;
    if (!result?.success || !result.identity?.identifier) return null;
    return result.identity;
  } catch (error) {
    debugLog('supportChat: handshake message failed', error);
    return null;
  }
}

/**
 * Spending-auth prompt for the one-time handshake.
 *
 * The stake key can only be unlocked with the spending password (or a PassKey PRF
 * secret), and collecting either needs UI this module must not own.
 *
 * CONTRACT — the two outcomes are NOT the same and must be signalled differently:
 * <ul>
 *   <li>resolve `null` = the user deliberately CANCELLED. `send()` returns false
 *       and leaves `errorKey` null, so the dock keeps the draft without flashing
 *       an error banner at someone who just changed their mind.</li>
 *   <li>THROW = auth genuinely failed (wrong password, PassKey error, no prompt
 *       wired yet). `send()` returns false with `support.error.sendFailed`.</li>
 * </ul>
 * Resolving an auth object means "proceed with these credentials".
 */
let authPrompt: (() => Promise<SupportAuthInput | null>) | null = null;

/** Wire the spending-auth prompt (called once by the UI layer that owns the dialog). */
export function setSupportAuthPrompt(prompt: (() => Promise<SupportAuthInput | null>) | null): void {
  authPrompt = prompt;
}

function defaultPromptAuth(): Promise<SupportAuthInput | null> {
  // No prompt wired yet is a FAILURE, not a user cancel — the send could never
  // have succeeded, so the dock should say so rather than silently swallow it.
  if (!authPrompt) return Promise.reject(new Error('Support chat auth prompt not wired'));
  return authPrompt();
}

function defaultWallet(): SupportWalletSnapshot | null {
  const logged = walletStore.loggedWallet as SupportWalletSnapshot | null;
  return logged && typeof logged.id === 'number' ? logged : null;
}

export function createSupportChat(deps: SupportChatDeps = {}) {
  const api: SupportChatApi = deps.api ?? chatwootSupportApi;
  const cache: SupportIdentityCache = deps.cache ?? supportIdentityCache;
  const makeCable = deps.createCable ?? createSupportCable;
  const requestIdentity = deps.requestIdentity ?? backgroundRequestIdentity;
  const promptAuth = deps.promptAuth ?? defaultPromptAuth;
  const readWallet = deps.wallet ?? defaultWallet;

  const messages: Ref<SupportMessage[]> = ref([]);
  const busy: Ref<boolean> = ref(false);
  const connectionState: Ref<SupportConnectionState> = ref<SupportConnectionState>('idle');
  const unread: Ref<number> = ref(0);
  const errorKey: Ref<string | null> = ref<string | null>(null);

  const isAvailable = computed<boolean>(() => {
    const wallet = readWallet();
    if (!wallet) return false;
    if (wallet.chain && wallet.chain !== Blockchain.CARDANO) return false;
    if (!wallet.stakeAddress || !wallet.stakeAddress.startsWith('stake1')) return false;
    return SIGNABLE_WALLET_TYPES.has(wallet.type || 'Normal');
  });

  let identity: SupportChatIdentity | null = null;
  let cable: SupportCable | null = null;
  let entered = false;
  let walletId: number | null = null;
  let nextLocalId = 1;

  function setError(key: string | null): void {
    errorKey.value = key;
  }

  function resetThread(): void {
    cable?.close();
    cable = null;
    identity = null;
    entered = false;
    messages.value = [];
    unread.value = 0;
    connectionState.value = 'idle';
    setError(null);
  }

  /** Append (or reconcile) a message that arrived from the server. */
  function ingest(message: SupportMessage): void {
    if (messages.value.some((m) => m.id === message.id)) return;
    if (message.role === 'user') {
      // Reconcile our own optimistic echo instead of showing the text twice.
      const optimistic = messages.value.findIndex((m) => m.id < 0 && m.text === message.text);
      if (optimistic !== -1) {
        messages.value.splice(optimistic, 1, message);
        return;
      }
    }
    messages.value.push(message);
    if (message.role === 'agent') unread.value += 1;
  }

  async function loadHistory(): Promise<void> {
    if (!identity?.sourceId || !identity.conversationId) return;
    try {
      messages.value = await api.listMessages(identity.sourceId, identity.conversationId);
    } catch (error) {
      debugLog('supportChat: history fetch failed', error);
    }
  }

  function connectCable(): void {
    if (!identity?.pubsubToken) return;
    if (cable) {
      cable.connect();
      return;
    }
    cable = makeCable({
      pubsubToken: identity.pubsubToken,
      onMessage: (message) => ingest(message),
      onState: (state: SupportCableState) => {
        connectionState.value = state;
      },
      // Broadcasts during a drop are not replayed, so refill from REST.
      onReconnected: () => {
        void loadHistory();
      },
    });
    cable.connect();
    connectionState.value = 'connecting';
  }

  /**
   * Re-point state at whichever wallet is active now. Returns the active id.
   * `autoReenter` is only set by the watcher: when an operation triggers the
   * switch it re-reads the new wallet's cache on its own, so re-entering there
   * would just duplicate the work.
   */
  function syncWallet(autoReenter = false): number | null {
    const current = readWallet();
    const id = current?.id ?? null;
    if (id !== walletId) {
      const hadEntered = entered;
      resetThread();
      walletId = id;
      if (autoReenter && hadEntered && id !== null) void enter();
    }
    return walletId;
  }

  /** Persist whatever we know about the identity so the next session skips the handshake. */
  async function persist(): Promise<void> {
    if (walletId === null || !identity) return;
    await cache.save(walletId, identity);
  }

  /**
   * Run the one-time stake-key handshake.
   *
   * `cancelled` (the prompt resolved null) is deliberately NOT `failed`: the user
   * chose not to authenticate, which is not an error worth rendering.
   */
  async function handshake(): Promise<IdentityOutcome> {
    let auth: SupportAuthInput | null;
    try {
      auth = await promptAuth();
    } catch (error) {
      debugLog('supportChat: auth prompt failed', error);
      return { status: 'failed' };
    }
    if (!auth) return { status: 'cancelled' };
    const verified = await requestIdentity(auth);
    if (!verified?.identifier) return { status: 'failed' };
    identity = { ...verified };
    await persist();
    return { status: 'ok', identity };
  }

  /** Cached identity, or the handshake result. */
  async function ensureIdentity(): Promise<IdentityOutcome> {
    if (identity?.identifier) return { status: 'ok', identity };
    if (walletId !== null) {
      const cachedIdentity = await cache.load(walletId);
      if (cachedIdentity?.identifier) {
        identity = cachedIdentity;
        return { status: 'ok', identity };
      }
    }
    return handshake();
  }

  /**
   * Contact + conversation, created lazily. `ensureContact` does the POST **and**
   * the mandatory PATCH — without the PATCH the contact is never hmac_verified and
   * silently loses its history across sessions.
   */
  async function ensureConversation(): Promise<SupportChatIdentity> {
    if (!identity) throw new ChatAuthError('No support identity');
    if (!identity.sourceId || !identity.pubsubToken) {
      const contact = await api.ensureContact({
        identifier: identity.identifier,
        identifierHash: identity.identifierHash,
        name: identity.displayName,
      });
      identity = { ...identity, sourceId: contact.sourceId, pubsubToken: contact.pubsubToken };
      await persist();
    }
    if (!identity.conversationId) {
      const conversationId = await api.createConversation(identity.sourceId as string);
      identity = { ...identity, conversationId };
      await persist();
    }
    return identity;
  }

  /**
   * Rebuild the identity from scratch after Chatwoot rejected the current one
   * (rotated/stale HMAC). Runs at most ONCE per send — a genuinely bad identity
   * would otherwise loop forever.
   */
  async function recoverIdentity(): Promise<boolean> {
    if (walletId !== null) await cache.clear(walletId);
    const displayName = identity?.displayName;
    identity = null;
    cable?.close();
    cable = null;
    const outcome = await handshake();
    if (outcome.status !== 'ok') return false;
    // Keep the pseudonym the agent already knows this person by if the fresh
    // handshake didn't return one — and persist it, or the cache keeps the blank.
    if (!outcome.identity.displayName && displayName) {
      identity = { ...outcome.identity, displayName };
      await persist();
    }
    return true;
  }

  async function enter(): Promise<void> {
    syncWallet();
    if (!isAvailable.value || walletId === null) return;
    if (entered && cable?.isConnected()) return;
    entered = true;
    setError(null);

    if (!identity?.identifier) {
      const cachedIdentity = await cache.load(walletId);
      // No identity yet → stay idle. The handshake (and its signature prompt)
      // only ever happens on an explicit send.
      if (!cachedIdentity?.identifier) return;
      identity = cachedIdentity;
    }
    if (!identity.sourceId || !identity.pubsubToken) return;

    connectionState.value = 'connecting';
    await loadHistory();
    connectCable();
  }

  async function deliver(text: string): Promise<void> {
    const target = await ensureConversation();
    const sent = await api.sendMessage(target.sourceId as string, target.conversationId as number, text);
    // Reconcile the optimistic echo with the server's id/timestamp immediately.
    // The cable is not necessarily subscribed yet on a first send, so waiting for
    // the broadcast would leave a negative local id in the thread until the next
    // history load. `ingest` dedupes, so a later broadcast of the same id is a no-op.
    if (sent) ingest(sent);
  }

  async function send(text: string): Promise<boolean> {
    syncWallet();
    const trimmed = (text || '').trim();
    if (!trimmed || busy.value) return false;
    if (!isAvailable.value || walletId === null) return false;

    busy.value = true;
    setError(null);
    let optimistic: SupportMessage | null = null;
    try {
      const known = await ensureIdentity();
      if (known.status !== 'ok') {
        // A deliberate cancel is not an error — the dock just keeps the draft.
        if (known.status === 'failed') setError('support.error.sendFailed');
        return false;
      }

      optimistic = { id: -nextLocalId++, role: 'user', text: trimmed, createdAt: Date.now() };
      messages.value.push(optimistic);

      try {
        await deliver(trimmed);
      } catch (error) {
        if (!(error instanceof ChatAuthError)) throw error;
        // Stale/rotated HMAC: rebuild the identity once, then retry once.
        debugLog('supportChat: identity rejected, re-running handshake');
        if (!(await recoverIdentity())) {
          setError('support.error.unavailable');
          return false;
        }
        try {
          await deliver(trimmed);
        } catch (retryError) {
          debugLog('supportChat: retry after re-handshake failed', retryError);
          setError('support.error.unavailable');
          return false;
        }
      }

      entered = true;
      connectCable();
      return true;
    } catch (error) {
      debugLog('supportChat: send failed', error);
      setError('support.error.sendFailed');
      return false;
    } finally {
      // A message that never reached Chatwoot must not linger in the thread —
      // send() returned false and the UI still owns the draft.
      if (optimistic && errorKey.value) {
        const index = messages.value.indexOf(optimistic);
        if (index !== -1) messages.value.splice(index, 1);
      }
      busy.value = false;
    }
  }

  function markSeen(): void {
    unread.value = 0;
  }

  // Wallet switch while the dock is open: drop the old thread and re-enter for the
  // new wallet (a different wallet is a different, unlinkable support identity).
  try {
    watch(
      () => readWallet()?.id ?? null,
      () => {
        syncWallet(true);
      },
    );
  } catch (error) {
    // No reactive context (e.g. background import) — the per-operation
    // syncWallet() calls still catch the switch.
    debugLog('supportChat: wallet watcher unavailable', error);
  }

  walletId = readWallet()?.id ?? null;

  return { messages, busy, connectionState, unread, isAvailable, errorKey, enter, send, markSeen };
}

/** Singleton shared by the dock UI so the thread survives route changes. */
export const supportChat: SupportChat = createSupportChat();
