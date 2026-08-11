// src/sidepanel/composables/useSupportChat.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Vue from 'vue';
import { nextTick } from 'vue';
import { createSupportChat, type SupportChatDeps, type SupportWalletSnapshot } from './useSupportChat';
import { ChatAuthError, type SupportApiMessage } from '@/api/chatwootSupport.client';
import type { SupportChatIdentity } from '@/services/support/identityCache';
import type { SupportCableOptions } from '@/services/support/actionCable';

const CARDANO_WALLET: SupportWalletSnapshot = {
  id: 1,
  chain: 'Cardano',
  type: 'Normal',
  stakeAddress: 'stake1uexample',
};

const VERIFIED = { identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' };

function makeHarness(overrides: Partial<SupportChatDeps> = {}) {
  const store: Record<number, SupportChatIdentity | null> = {};
  const cable = {
    connect: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  };
  let cableOptions: SupportCableOptions | null = null;

  const api = {
    ensureContact: vi.fn().mockResolvedValue({ sourceId: 'src-1', pubsubToken: 'tok-1' }),
    createConversation: vi.fn().mockResolvedValue(42),
    listMessages: vi.fn().mockResolvedValue([] as SupportApiMessage[]),
    sendMessage: vi.fn().mockResolvedValue(null),
  };
  const cache = {
    load: vi.fn(async (walletId: number) => store[walletId] ?? null),
    save: vi.fn(async (walletId: number, identity: SupportChatIdentity) => {
      store[walletId] = identity;
    }),
    clear: vi.fn(async (walletId: number) => {
      store[walletId] = null;
    }),
  };
  const promptAuth = vi.fn().mockResolvedValue({ password: 'pw' });
  const requestIdentity = vi.fn().mockResolvedValue(VERIFIED);
  const wallet = vi.fn().mockReturnValue(CARDANO_WALLET);

  const deps: SupportChatDeps = {
    api,
    cache,
    promptAuth,
    requestIdentity,
    wallet,
    createCable: (options) => {
      cableOptions = options;
      return cable;
    },
    ...overrides,
  };

  const chat = createSupportChat(deps);
  return {
    chat,
    api,
    cache,
    store,
    cable,
    promptAuth,
    requestIdentity,
    wallet,
    cableOptions: () => cableOptions,
  };
}

function cached(extra: Partial<SupportChatIdentity> = {}): SupportChatIdentity {
  return { ...VERIFIED, sourceId: 'src-1', pubsubToken: 'tok-1', conversationId: 42, ...extra };
}

describe('useSupportChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('availability', () => {
    it('is available for a Cardano software wallet with a reward address', () => {
      const h = makeHarness();
      expect(h.chat.isAvailable.value).toBe(true);
    });

    it('is unavailable for a hardware wallet (no signable stake key in the background)', () => {
      const h = makeHarness({ wallet: () => ({ ...CARDANO_WALLET, type: 'Ledger' }) });
      expect(h.chat.isAvailable.value).toBe(false);
    });

    it('is unavailable without a reward address (enterprise / non-Cardano chain)', () => {
      expect(makeHarness({ wallet: () => ({ ...CARDANO_WALLET, stakeAddress: '' }) }).chat.isAvailable.value).toBe(false);
      expect(
        makeHarness({ wallet: () => ({ id: 2, chain: 'Bitcoin', type: 'Normal' }) }).chat.isAvailable.value,
      ).toBe(false);
    });

    it('send() on an unavailable wallet returns false with no side effects', async () => {
      const h = makeHarness({ wallet: () => ({ ...CARDANO_WALLET, type: 'Trezor' }) });
      const ok = await h.chat.send('help');
      expect(ok).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.chat.errorKey.value).toBeNull();
    });
  });

  describe('enter()', () => {
    it('stays idle and runs NO handshake when no identity is cached', async () => {
      const h = makeHarness();
      await h.chat.enter();
      expect(h.chat.connectionState.value).toBe('idle');
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.cable.connect).not.toHaveBeenCalled();
    });

    it('loads history and connects the cable when an identity is cached', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.listMessages.mockResolvedValue([
        { id: 1, role: 'user', text: 'gm', createdAt: 1 },
        { id: 2, role: 'agent', text: 'hi', agentName: 'Ada', createdAt: 2 },
      ]);
      await h.chat.enter();
      expect(h.api.listMessages).toHaveBeenCalledWith('src-1', 42);
      expect(h.chat.messages.value.map((m) => m.id)).toEqual([1, 2]);
      expect(h.cable.connect).toHaveBeenCalledTimes(1);
      expect(h.chat.connectionState.value).toBe('connecting');
      h.cableOptions()?.onState('connected');
      expect(h.chat.connectionState.value).toBe('connected');
    });

    it('is idempotent — a second enter() does not re-open the cable', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.cable.isConnected.mockReturnValue(true);
      await h.chat.enter();
      expect(h.cable.connect).toHaveBeenCalledTimes(1);
      expect(h.api.listMessages).toHaveBeenCalledTimes(1);
    });

    it('refetches history when the cable reconnects (gap fill)', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.api.listMessages.mockResolvedValue([{ id: 9, role: 'agent', text: 'missed you', createdAt: 9 }]);
      await h.cableOptions()?.onReconnected?.();
      await nextTick();
      expect(h.api.listMessages).toHaveBeenCalledTimes(2);
      expect(h.chat.messages.value.map((m) => m.id)).toEqual([9]);
    });
  });

  describe('first send()', () => {
    it('runs the handshake, verifies the contact, opens a conversation, then sends', async () => {
      const h = makeHarness();
      const ok = await h.chat.send('  my tx is stuck  ');
      expect(ok).toBe(true);

      expect(h.promptAuth).toHaveBeenCalledTimes(1);
      expect(h.requestIdentity).toHaveBeenCalledWith({ password: 'pw' });
      expect(h.api.ensureContact).toHaveBeenCalledWith({
        identifier: 'v1:aa',
        identifierHash: 'hh',
        name: 'quiet-dew-4f2a',
      });
      expect(h.api.createConversation).toHaveBeenCalledWith('src-1');
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-1', 42, 'my tx is stuck');

      // Optimistic echo with a negative (local) id.
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].role).toBe('user');
      expect(h.chat.messages.value[0].text).toBe('my tx is stuck');
      expect(h.chat.messages.value[0].id).toBeLessThan(0);
      expect(h.chat.busy.value).toBe(false);
      expect(h.cable.connect).toHaveBeenCalled();
    });

    it('caches identity + contact + conversation so the next send reuses everything', async () => {
      const h = makeHarness();
      await h.chat.send('one');
      await h.chat.send('two');
      expect(h.promptAuth).toHaveBeenCalledTimes(1);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).toHaveBeenCalledTimes(1);
      expect(h.api.createConversation).toHaveBeenCalledTimes(1);
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(h.store[1]).toMatchObject({ identifier: 'v1:aa', sourceId: 'src-1', conversationId: 42 });
    });

    it('returns false and appends NOTHING when the user cancels auth', async () => {
      const h = makeHarness({ promptAuth: vi.fn().mockResolvedValue(null) });
      const ok = await h.chat.send('hello');
      expect(ok).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.chat.busy.value).toBe(false);
    });

    it('returns false and appends NOTHING when the handshake itself fails', async () => {
      const h = makeHarness({ requestIdentity: vi.fn().mockResolvedValue(null) });
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
    });

    it('rolls back the optimistic message when the send request fails', async () => {
      const h = makeHarness();
      h.api.sendMessage.mockRejectedValue(new Error('network down'));
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
    });

    it('ignores blank input', async () => {
      const h = makeHarness();
      expect(await h.chat.send('   ')).toBe(false);
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.chat.messages.value).toEqual([]);
    });
  });

  describe('ChatAuthError recovery', () => {
    it('clears the cache, re-handshakes ONCE and retries the send', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValueOnce(new ChatAuthError('rejected'));
      h.requestIdentity.mockResolvedValue({ ...VERIFIED, identifier: 'v1:new', identifierHash: 'h2' });

      const ok = await h.chat.send('hi again');

      expect(ok).toBe(true);
      expect(h.cache.clear).toHaveBeenCalledWith(1);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).toHaveBeenCalledWith({
        identifier: 'v1:new',
        identifierHash: 'h2',
        name: 'quiet-dew-4f2a',
      });
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['hi again']);
      expect(h.chat.errorKey.value).toBeNull();
    });

    it('gives up with support.error.unavailable when the retry is rejected too', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatAuthError('rejected'));

      const ok = await h.chat.send('hi again');

      expect(ok).toBe(false);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1); // exactly one silent re-handshake
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2); // original + one retry
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
      expect(h.chat.messages.value).toEqual([]);
    });

    it('gives up when the re-handshake cannot authenticate', async () => {
      const h = makeHarness({ promptAuth: vi.fn().mockResolvedValue(null) });
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatAuthError('rejected'));
      expect(await h.chat.send('hi')).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
    });
  });

  describe('incoming messages', () => {
    it('appends agent messages from the cable and counts them as unread until markSeen()', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onMessage({ id: 5, role: 'agent', text: 'on it', agentName: 'Ada', createdAt: 5 });
      opts?.onMessage({ id: 6, role: 'agent', text: 'fixed', agentName: 'Ada', createdAt: 6 });
      expect(h.chat.unread.value).toBe(2);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['on it', 'fixed']);
      h.chat.markSeen();
      expect(h.chat.unread.value).toBe(0);
    });

    it('does not count the user\'s own echoed message as unread, and dedupes by id', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onMessage({ id: 7, role: 'user', text: 'gm', createdAt: 7 });
      opts?.onMessage({ id: 7, role: 'user', text: 'gm', createdAt: 7 });
      expect(h.chat.unread.value).toBe(0);
      expect(h.chat.messages.value.filter((m) => m.id === 7)).toHaveLength(1);
    });

    it('replaces the optimistic echo when the same text comes back from the server', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      await h.chat.send('gm');
      expect(h.chat.messages.value[0].id).toBeLessThan(0);
      h.cableOptions()?.onMessage({ id: 21, role: 'user', text: 'gm', createdAt: 21 });
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].id).toBe(21);
    });

    it('maps cable state onto connectionState', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onState('reconnecting');
      expect(h.chat.connectionState.value).toBe('reconnecting');
      opts?.onState('unavailable');
      expect(h.chat.connectionState.value).toBe('unavailable');
    });
  });

  describe('wallet switch', () => {
    it('resets the thread and re-reads the cache for the new wallet', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      h.api.listMessages.mockResolvedValue([{ id: 1, role: 'user', text: 'wallet one', createdAt: 1 }]);
      await h.chat.enter();
      h.chat.unread.value = 3;
      expect(h.chat.messages.value).toHaveLength(1);

      active.wallet = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      h.api.listMessages.mockResolvedValue([{ id: 8, role: 'user', text: 'wallet two', createdAt: 8 }]);
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(h.cable.close).toHaveBeenCalled();
      expect(h.chat.unread.value).toBe(0);
      expect(h.api.listMessages).toHaveBeenLastCalledWith('src-2', 77);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['wallet two']);
    });

    it('a send after a switch uses the NEW wallet identity', async () => {
      let current: SupportWalletSnapshot = CARDANO_WALLET;
      const h = makeHarness({ wallet: () => current });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', identifierHash: 'h2', sourceId: 'src-2', conversationId: 77 });
      await h.chat.enter();
      current = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      await h.chat.send('hello from wallet two');
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-2', 77, 'hello from wallet two');
      expect(h.promptAuth).not.toHaveBeenCalled();
    });
  });
});
