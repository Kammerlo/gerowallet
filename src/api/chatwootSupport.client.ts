/**
 * Chatwoot public Client API — non-custodial live support chat.
 *
 * <p>The wallet talks DIRECTLY to the Chatwoot public inbox endpoints; there is no
 * Gero-side relay for the chat traffic itself. The only server-side step is the
 * identity handshake (Nexus signs off on a pseudonymous identifier + HMAC after
 * verifying a CIP-8 signature from the wallet's stake key — see
 * {@link ../chrome/supportChatAuth.ts}). Nothing here ever sees a stake address,
 * a key, or a password.
 *
 * <p>Two behaviours of the live instance are load-bearing and non-obvious:
 * <ol>
 *   <li>The inbox runs with {@code hmac_mandatory=true}. A missing/wrong
 *       {@code identifier_hash} is rejected with HTTP <b>500</b> (a bare
 *       StandardError server-side), NOT 401 — so 500 on the CONTACT endpoints is
 *       mapped to {@link ChatAuthError} and must never be blind-retried.</li>
 *   <li>{@code POST /contacts} does NOT set {@code hmac_verified}. The contact must
 *       be PATCHed with the SAME identifier + identifier_hash immediately after
 *       creation or the contact stays unverified and loses its conversation
 *       history across sessions/devices. {@link chatwootSupportApi.ensureContact}
 *       is the only sanctioned way to create a contact.</li>
 * </ol>
 */

import axios, { type AxiosInstance } from 'axios';

/** Public support origin. Overridable per-environment; defaults to production. */
export const SUPPORT_CHAT_ORIGIN: string =
  import.meta.env['VITE_SUPPORT_CHAT_URL'] || 'https://support.gerowallet.io';

/** Website-inbox identifier configured on the Chatwoot side. */
export const SUPPORT_INBOX_IDENTIFIER = 'gerowallet-extension';

/** `wss://…/cable` endpoint for the ActionCable realtime stream. */
export const SUPPORT_CABLE_URL: string = `${SUPPORT_CHAT_ORIGIN.replace(/^http/, 'ws').replace(/\/+$/, '')}/cable`;

export const supportChatAxiosInstance: AxiosInstance = axios.create({
  baseURL: `${SUPPORT_CHAT_ORIGIN.replace(/\/+$/, '')}/public/api/v1/inboxes/${SUPPORT_INBOX_IDENTIFIER}`,
  timeout: 20_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

/**
 * The contact's identity was rejected by Chatwoot (hmac_mandatory inbox). The
 * cached identity must be discarded and the Nexus handshake re-run ONCE — never
 * retried in a loop, since a genuinely bad HMAC will fail forever.
 */
export class ChatAuthError extends Error {
  constructor(message = 'Support chat identity rejected') {
    super(message);
    this.name = 'ChatAuthError';
  }
}

/** Any other failure talking to Chatwoot (network, 4xx, 5xx on non-contact paths). */
export class ChatRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ChatRequestError';
    this.status = status;
  }
}

export interface SupportContactIdentity {
  identifier: string;
  identifierHash: string;
  name?: string;
}

export interface SupportContact {
  sourceId: string;
  pubsubToken: string;
}

/** Normalized message, matching the composable's `SupportMessage` shape. */
export interface SupportApiMessage {
  id: number;
  role: 'user' | 'agent';
  text: string;
  agentName?: string;
  createdAt: number;
}

/** Chatwoot `message_type`: 0 incoming (from the user), 1 outgoing (agent), 2 activity. */
const MESSAGE_TYPE_INCOMING = 0;
const MESSAGE_TYPE_OUTGOING = 1;

/** Raw Chatwoot message payload — identical over REST and over the ActionCable stream. */
export interface RawChatwootMessage {
  id?: number;
  content?: string;
  message_type?: number;
  created_at?: number | string;
  sender?: { name?: string } | null;
  private?: boolean;
}

function statusOf(error: unknown): number | undefined {
  const res = (error as { response?: { status?: number } } | null)?.response;
  return typeof res?.status === 'number' ? res.status : undefined;
}

function asRequestError(error: unknown, what: string): ChatRequestError {
  const status = statusOf(error);
  return new ChatRequestError(`${what} failed${status ? ` (${status})` : ''}`, status);
}

/**
 * Contact-endpoint error mapping. HTTP 500 from an hmac_mandatory inbox means the
 * identifier_hash was missing/stale/wrong — an AUTH failure, not a server outage.
 */
function throwContactError(error: unknown, what: string): never {
  if (error instanceof ChatAuthError) throw error;
  if (statusOf(error) === 500) throw new ChatAuthError(`${what} rejected by the support inbox`);
  throw asRequestError(error, what);
}

/** Chatwoot emits unix SECONDS; normalize to epoch ms (already-ms values pass through). */
function toEpochMs(value: number | string | undefined): number {
  const n = typeof value === 'string' ? Date.parse(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return Date.now();
  return n > 0 && n < 1e12 ? n * 1000 : n;
}

/**
 * Normalize a raw Chatwoot message. Returns null for anything the chat must not
 * render: activity events (message_type 2), private agent notes, and empty bodies.
 */
export function normalizeChatwootMessage(
  raw: RawChatwootMessage | null | undefined,
): SupportApiMessage | null {
  if (!raw || typeof raw.id !== 'number') return null;
  if (raw.private === true) return null;
  const type = raw.message_type;
  if (type !== MESSAGE_TYPE_INCOMING && type !== MESSAGE_TYPE_OUTGOING) return null;
  const text = typeof raw.content === 'string' ? raw.content : '';
  if (!text) return null;
  const isAgent = type === MESSAGE_TYPE_OUTGOING;
  return {
    id: raw.id,
    role: isAgent ? 'agent' : 'user',
    text,
    agentName: isAgent ? raw.sender?.name || undefined : undefined,
    createdAt: toEpochMs(raw.created_at),
  };
}

/** The contact body Chatwoot needs on BOTH the create and the update call. */
function contactBody(identity: SupportContactIdentity): Record<string, string> {
  const body: Record<string, string> = {
    identifier: identity.identifier,
    identifier_hash: identity.identifierHash,
  };
  if (identity.name) body['name'] = identity.name;
  return body;
}

export const chatwootSupportApi = {
  /**
   * Create the pseudonymous contact. NOTE: this alone leaves the contact
   * hmac-UNVERIFIED — callers must use {@link ensureContact} instead.
   */
  async createContact(identity: SupportContactIdentity): Promise<SupportContact> {
    try {
      const { data } = await supportChatAxiosInstance.post<{ source_id?: string; pubsub_token?: string }>(
        '/contacts',
        contactBody(identity),
      );
      const sourceId = data?.source_id;
      const pubsubToken = data?.pubsub_token;
      if (!sourceId || !pubsubToken) {
        throw new ChatRequestError('Support contact response missing source_id/pubsub_token');
      }
      return { sourceId, pubsubToken };
    } catch (error) {
      throwContactError(error, 'Support contact create');
    }
  },

  /**
   * Re-send the identity to an existing contact. This is the call that actually
   * flips `hmac_verified` on the Chatwoot side, which is what preserves the
   * conversation across sessions and devices.
   */
  async updateContact(sourceId: string, identity: SupportContactIdentity): Promise<void> {
    try {
      await supportChatAxiosInstance.patch(`/contacts/${encodeURIComponent(sourceId)}`, contactBody(identity));
    } catch (error) {
      throwContactError(error, 'Support contact update');
    }
  },

  /**
   * Create + verify a contact in one step (POST then the mandatory PATCH).
   * The ONLY sanctioned contact-creation path.
   */
  async ensureContact(identity: SupportContactIdentity): Promise<SupportContact> {
    const contact = await this.createContact(identity);
    await this.updateContact(contact.sourceId, identity);
    return contact;
  },

  /** Open a conversation for the contact. Created lazily on the first send. */
  async createConversation(sourceId: string): Promise<number> {
    try {
      const { data } = await supportChatAxiosInstance.post<{ id?: number }>(
        `/contacts/${encodeURIComponent(sourceId)}/conversations`,
        {},
      );
      if (typeof data?.id !== 'number') throw new ChatRequestError('Support conversation response missing id');
      return data.id;
    } catch (error) {
      if (error instanceof ChatRequestError) throw error;
      throw asRequestError(error, 'Support conversation create');
    }
  },

  /** Full message history for the conversation, oldest first, renderable only. */
  async listMessages(sourceId: string, conversationId: number): Promise<SupportApiMessage[]> {
    try {
      const { data } = await supportChatAxiosInstance.get<RawChatwootMessage[] | { payload?: RawChatwootMessage[] }>(
        `/contacts/${encodeURIComponent(sourceId)}/conversations/${conversationId}/messages`,
      );
      const list: RawChatwootMessage[] = Array.isArray(data) ? data : Array.isArray(data?.payload) ? data.payload : [];
      return list
        .map(normalizeChatwootMessage)
        .filter((m): m is SupportApiMessage => m !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch (error) {
      throw asRequestError(error, 'Support message history');
    }
  },

  /** Post a user message into the conversation. */
  async sendMessage(sourceId: string, conversationId: number, content: string): Promise<SupportApiMessage | null> {
    try {
      const { data } = await supportChatAxiosInstance.post<RawChatwootMessage>(
        `/contacts/${encodeURIComponent(sourceId)}/conversations/${conversationId}/messages`,
        { content },
      );
      return normalizeChatwootMessage(data);
    } catch (error) {
      throw asRequestError(error, 'Support message send');
    }
  },
};

export type ChatwootSupportApi = typeof chatwootSupportApi;
