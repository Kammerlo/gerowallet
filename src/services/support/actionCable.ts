/**
 * Rails ActionCable client for the Chatwoot support inbox (`wss://…/cable`).
 *
 * <p>Deliberately hand-rolled instead of pulling in `@rails/actioncable`: the
 * protocol we need is four frame types, and the extension already ships its own
 * WebSocket plumbing (see `src/services/websocket.service.ts`) rather than a
 * socket framework.
 *
 * <p>Protocol (verified against the live instance):
 * <ul>
 *   <li>server → {@code {"type":"welcome"}} on connect; the client only subscribes
 *       AFTER this, per the ActionCable handshake.</li>
 *   <li>client → {@code {"command":"subscribe","identifier":"<json string>"}} where
 *       the identifier is a JSON-encoded STRING (double-encoded on the wire).</li>
 *   <li>server → {@code {"type":"confirm_subscription"}} once the stream is live,
 *       then {@code {"type":"ping"}} roughly every 3s.</li>
 *   <li>server → {@code {identifier, message:{event:"message.created", data:{…}}}}
 *       for chat traffic. Any other event is ignored.</li>
 * </ul>
 *
 * <p>Nothing here is logged: the pubsub token is a bearer credential for the
 * conversation stream.
 */

import { normalizeChatwootMessage, SUPPORT_CABLE_URL, type SupportApiMessage } from '@/api/chatwootSupport.client';
import { debugLog } from '@/utils/debug';

/** Connection states the cable reports. `idle` is owned by the composable, not the cable. */
export type SupportCableState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

/** The slice of WebSocket the cable uses — lets tests inject a fake socket. */
export interface CableSocket {
  send(data: string): void;
  close(): void;
  onopen: ((...args: unknown[]) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((...args: unknown[]) => void) | null;
  onerror: ((...args: unknown[]) => void) | null;
}

export interface SupportCableOptions {
  /** Chatwoot contact `pubsub_token` — the stream credential. Never logged. */
  pubsubToken: string;
  /** Cable endpoint; defaults to the support origin's `/cable`. */
  url?: string;
  /** Fired for every renderable message.created (activity + private notes dropped). */
  onMessage: (message: SupportApiMessage) => void;
  onState: (state: SupportCableState) => void;
  /**
   * Fired after a RE-subscribe (never on the first one). Messages broadcast while
   * the socket was down are not replayed, so the composable refetches history here.
   */
  onReconnected?: () => void;
  socketFactory?: (url: string) => CableSocket;
  /** Capped exponential backoff. Exhausting the list ends in `unavailable`. */
  retryDelaysMs?: number[];
  /** Treat the socket as dead if the server goes quiet for this long (pings are ~3s). */
  pingTimeoutMs?: number;
}

export interface SupportCable {
  /** Idempotent: no-op while a socket is live or a reconnect is scheduled. */
  connect(): void;
  /** Intentional teardown — cancels reconnects. A later connect() starts fresh. */
  close(): void;
  isConnected(): boolean;
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_PING_TIMEOUT_MS = 20000;

function defaultSocketFactory(url: string): CableSocket {
  return new WebSocket(url) as unknown as CableSocket;
}

interface CableFrame {
  type?: string;
  identifier?: string;
  message?: { event?: string; data?: unknown };
}

export function createSupportCable(options: SupportCableOptions): SupportCable {
  const url = options.url || SUPPORT_CABLE_URL;
  const makeSocket = options.socketFactory || defaultSocketFactory;
  const retryDelays = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const subscribeFrame = JSON.stringify({
    command: 'subscribe',
    identifier: JSON.stringify({ channel: 'RoomChannel', pubsub_token: options.pubsubToken }),
  });

  let socket: CableSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let subscribed = false;
  let hasSubscribedBefore = false;
  let closedByUs = false;
  let exhausted = false;

  function clearTimers(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
  }

  function detach(): void {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket = null;
  }

  function armPingTimeout(): void {
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      // The server went quiet — the socket can stay "open" forever in that state,
      // so drop it ourselves and let the normal backoff path bring it back.
      debugLog('supportChat: cable went quiet, forcing reconnect');
      dropAndScheduleReconnect();
    }, pingTimeoutMs);
  }

  function dropAndScheduleReconnect(): void {
    const current = socket;
    detach();
    try {
      current?.close();
    } catch {
      /* already closing */
    }
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (closedByUs || reconnectTimer) return;
    subscribed = false;
    if (pingTimer) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
    if (attempt >= retryDelays.length) {
      exhausted = true;
      options.onState('unavailable');
      return;
    }
    const delay = retryDelays[attempt];
    attempt += 1;
    options.onState('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function handleFrame(raw: unknown): void {
    let frame: CableFrame;
    try {
      frame = typeof raw === 'string' ? (JSON.parse(raw) as CableFrame) : (raw as CableFrame);
    } catch {
      return; // not JSON — nothing actionable
    }
    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'welcome':
        socket?.send(subscribeFrame);
        armPingTimeout();
        return;
      case 'ping':
        armPingTimeout();
        return;
      case 'confirm_subscription': {
        subscribed = true;
        attempt = 0;
        armPingTimeout();
        options.onState('connected');
        if (hasSubscribedBefore) options.onReconnected?.();
        hasSubscribedBefore = true;
        return;
      }
      case 'reject_subscription':
      case 'disconnect':
        dropAndScheduleReconnect();
        return;
      default:
        break;
    }

    if (frame.message?.event !== 'message.created') return; // unknown event -> ignore
    const message = normalizeChatwootMessage(frame.message.data as Parameters<typeof normalizeChatwootMessage>[0]);
    if (message) options.onMessage(message);
  }

  function open(): void {
    closedByUs = false;
    options.onState(attempt === 0 ? 'connecting' : 'reconnecting');
    let next: CableSocket;
    try {
      next = makeSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => armPingTimeout();
    next.onmessage = (event) => handleFrame(event?.data);
    next.onclose = () => {
      if (socket !== next) return;
      detach();
      scheduleReconnect();
    };
    next.onerror = () => {
      if (socket !== next) return;
      detach();
      try {
        next.close();
      } catch {
        /* already closing */
      }
      scheduleReconnect();
    };
  }

  return {
    connect(): void {
      if (socket || reconnectTimer) return;
      if (exhausted) {
        // A later enter()/send() is allowed to retry after the budget ran out.
        exhausted = false;
        attempt = 0;
      }
      open();
    },
    close(): void {
      closedByUs = true;
      clearTimers();
      subscribed = false;
      attempt = 0;
      const current = socket;
      detach();
      try {
        current?.close();
      } catch {
        /* already closing */
      }
    },
    isConnected(): boolean {
      return subscribed;
    },
  };
}
