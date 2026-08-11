// src/sidepanel/composables/useSupportAuthPrompt.spec.ts
//
// The prompt is only interesting as the other half of useSupportChat's
// `promptAuth` contract, so the last two describes wire the REAL hook (via the
// module-level `setSupportAuthPrompt`) into a real `createSupportChat` and drive
// it from `send()`. The dialog itself is not mounted — `SupportAuthPrompt.vue`
// is a thin shell over these functions.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import {
  createSupportAuthPrompt,
  isPrfWallet,
  type SupportAuthPrompt,
  type SupportAuthWallet,
} from './useSupportAuthPrompt';
import {
  createSupportChat,
  setSupportAuthPrompt,
  type SupportChat,
  type SupportWalletSnapshot,
} from './useSupportChat';
import type { SupportChatIdentity } from '@/services/support/identityCache';

const CARDANO_WALLET: SupportWalletSnapshot = {
  id: 1,
  chain: 'Cardano',
  type: 'Normal',
  stakeAddress: 'stake1uexample',
};

const PASSWORD_WALLET: SupportAuthWallet = {};
const PRF_WALLET: SupportAuthWallet = { encryptionMethod: 'prf' };

/** Drain the promise queue so a suspended `send()` reaches its next await. */
async function flushPromises(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makePrompt(wallet: SupportAuthWallet | null = PASSWORD_WALLET): SupportAuthPrompt {
  return createSupportAuthPrompt({ wallet: () => wallet });
}

/**
 * A real chat with every network/storage collaborator faked, but NO `promptAuth`
 * dep — so it falls through to the module hook the prompt registers, which is
 * exactly the wiring under test.
 */
function makeChat(): {
  chat: SupportChat;
  requestIdentity: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const store: Record<number, SupportChatIdentity | null> = {};
  const requestIdentity = vi
    .fn()
    .mockResolvedValue({ identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' });
  const sendMessage = vi.fn().mockResolvedValue(null);
  const chat = createSupportChat({
    api: {
      ensureContact: vi.fn().mockResolvedValue({ sourceId: 'src-1', pubsubToken: 'tok-1' }),
      createConversation: vi.fn().mockResolvedValue(42),
      listMessages: vi.fn().mockResolvedValue([]),
      sendMessage,
    },
    cache: {
      load: vi.fn(async (walletId: number) => store[walletId] ?? null),
      save: vi.fn(async (walletId: number, identity: SupportChatIdentity) => {
        store[walletId] = identity;
      }),
      clear: vi.fn(async (walletId: number) => {
        store[walletId] = null;
      }),
    },
    createCable: () => ({ connect: vi.fn(), close: vi.fn(), isConnected: () => false }),
    requestIdentity,
    wallet: () => CARDANO_WALLET,
  });
  return { chat, requestIdentity, sendMessage };
}

afterEach(() => {
  // The hook is a module singleton — never let one test's prompt stay wired.
  setSupportAuthPrompt(null);
});

describe('isPrfWallet', () => {
  it('detects the modern encryptionMethod marker', () => {
    expect(isPrfWallet({ encryptionMethod: 'prf' })).toBe(true);
  });

  it('detects a legacy record by its credential + PRF-encrypted key pair', () => {
    expect(isPrfWallet({ prfEncryptedPrivateKey: 'enc', webAuthnCredentialId: 'cred' })).toBe(true);
  });

  it('is false for a password wallet, and for half a legacy pair', () => {
    expect(isPrfWallet({})).toBe(false);
    expect(isPrfWallet({ encryptionMethod: 'password' })).toBe(false);
    expect(isPrfWallet({ prfEncryptedPrivateKey: 'enc' })).toBe(false);
    expect(isPrfWallet({ webAuthnCredentialId: 'cred' })).toBe(false);
  });

  it('is false with no wallet at all (fails closed)', () => {
    expect(isPrfWallet(null)).toBe(false);
  });
});

describe('useSupportAuthPrompt', () => {
  it('opens against the active wallet and resolves the typed password', async () => {
    const prompt = makePrompt();
    const pending = prompt.open();
    expect(prompt.isOpen.value).toBe(true);
    expect(prompt.isPrf.value).toBe(false);

    prompt.submitPassword('hunter2');

    expect(await pending).toEqual({ password: 'hunter2' });
    expect(prompt.isOpen.value).toBe(false);
  });

  it('ignores an empty password submission and stays open', async () => {
    const prompt = makePrompt();
    const pending = prompt.open();
    prompt.submitPassword('');
    expect(prompt.isOpen.value).toBe(true);

    prompt.submitPassword('hunter2');
    expect(await pending).toEqual({ password: 'hunter2' });
  });

  it('asks a PRF wallet for key bytes and resolves them as a plain array', async () => {
    const prompt = makePrompt(PRF_WALLET);
    const pending = prompt.open();
    expect(prompt.isPrf.value).toBe(true);

    prompt.submitPrivateKeyBytes(new Uint8Array([1, 2, 3]));

    // A plain array, not the typed array: chrome messaging cannot structured-clone
    // a Uint8Array into something the background reads back as bytes.
    const auth = await pending;
    expect(auth).toEqual({ privateKeyBytes: [1, 2, 3] });
    expect(Array.isArray(auth?.privateKeyBytes)).toBe(true);
  });

  it('resolves null on cancel — the caller must not treat it as a failure', async () => {
    const prompt = makePrompt();
    const pending = prompt.open();
    prompt.cancel();
    expect(await pending).toBeNull();
    expect(prompt.isOpen.value).toBe(false);
  });

  it('keeps the prompt open with an inline key when the PassKey ceremony fails', () => {
    const prompt = makePrompt(PRF_WALLET);
    void prompt.open();
    prompt.reportAuthError();
    expect(prompt.isOpen.value).toBe(true);
    expect(prompt.errorKey.value).toBe('security.passKeyAuthFailed');
  });

  it('clears a stale error when the prompt settles', async () => {
    const prompt = makePrompt(PRF_WALLET);
    const pending = prompt.open();
    prompt.reportAuthError();
    prompt.cancel();
    await pending;
    expect(prompt.errorKey.value).toBeNull();
  });

  it('never strands a pending prompt: a second open settles the first as a cancel', async () => {
    const prompt = makePrompt();
    const first = prompt.open();
    const second = prompt.open();
    expect(await first).toBeNull();

    prompt.submitPassword('hunter2');
    expect(await second).toEqual({ password: 'hunter2' });
  });

  it('unregister() unwires the hook and cancels anything still awaiting it', async () => {
    const setPrompt = vi.fn();
    const prompt = createSupportAuthPrompt({ wallet: () => PASSWORD_WALLET, setPrompt });

    prompt.register();
    expect(setPrompt).toHaveBeenCalledWith(prompt.open);

    const pending = prompt.open();
    prompt.unregister();

    expect(setPrompt).toHaveBeenLastCalledWith(null);
    // Unmounting the dialog must not leave a send awaiting a prompt that can
    // never be answered — it resolves as a cancel (draft kept, no error).
    expect(await pending).toBeNull();
  });
});

describe('useSupportAuthPrompt wired into useSupportChat', () => {
  it('the first send reaches the REGISTERED prompt and hands its password to the handshake', async () => {
    const prompt = makePrompt();
    prompt.register();
    const { chat, requestIdentity, sendMessage } = makeChat();

    const sending = chat.send('my tx is stuck');
    await flushPromises();
    expect(prompt.isOpen.value).toBe(true);
    expect(requestIdentity).not.toHaveBeenCalled();

    prompt.submitPassword('hunter2');

    expect(await sending).toBe(true);
    expect(requestIdentity).toHaveBeenCalledWith({ password: 'hunter2' });
    expect(sendMessage).toHaveBeenCalledWith('src-1', 42, 'my tx is stuck');
    expect(chat.errorKey.value).toBeNull();
  });

  it('a PRF wallet hands its key bytes to the handshake instead', async () => {
    const prompt = makePrompt(PRF_WALLET);
    prompt.register();
    const { chat, requestIdentity } = makeChat();

    const sending = chat.send('help');
    await flushPromises();
    expect(prompt.isPrf.value).toBe(true);

    prompt.submitPrivateKeyBytes(new Uint8Array([7, 8]));

    expect(await sending).toBe(true);
    expect(requestIdentity).toHaveBeenCalledWith({ privateKeyBytes: [7, 8] });
  });

  it('cancelling the prompt aborts the send quietly: no error, no bubble, draft kept', async () => {
    const prompt = makePrompt();
    prompt.register();
    const { chat, requestIdentity, sendMessage } = makeChat();

    const sending = chat.send('never mind');
    await flushPromises();
    prompt.cancel();

    // false = not sent, so the dock keeps the draft — and cancelling is a choice,
    // not a failure, so no banner and nothing left in the thread.
    expect(await sending).toBe(false);
    expect(chat.errorKey.value).toBeNull();
    expect(chat.messages.value).toEqual([]);
    expect(requestIdentity).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(chat.busy.value).toBe(false);
  });

  it('a send with NO prompt wired is a failure, not a cancel', async () => {
    const { chat } = makeChat();
    expect(await chat.send('hello')).toBe(false);
    expect(chat.errorKey.value).toBe('support.error.sendFailed');
  });
});
