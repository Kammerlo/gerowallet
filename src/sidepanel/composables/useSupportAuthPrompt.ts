// src/sidepanel/composables/useSupportAuthPrompt.ts
//
// Spending-auth prompt for the support chat's ONE-TIME identity handshake.
//
// `useSupportChat` deliberately owns no UI: it calls an injected `promptAuth()`
// hook and reads the outcome from how that hook settles (credentials = proceed,
// `null` = the user cancelled, throw = auth failed). This module is the other
// half — the state machine behind that hook — and `SupportAuthPrompt.vue` is its
// face. Splitting them keeps the chat testable without a DOM and keeps the
// dialog testable without a network.
//
// PRECEDENT: RemoteSigningDialog.vue's enable-time auth, which collects exactly
// the same `{ password } | { privateKeyBytes }` pair for the cross-device
// wallet-control proof (`remoteSigningStore.produceProof`). Same wallet-type
// split, same `PassKeyAuthButton` for PRF wallets (which owns the side panel's
// `?mode=privateKey#/passkey-auth` popup, since WebAuthn cannot run in a side
// panel), same "software wallets type the spending password" rule.
//
// WRONG PASSWORD is not detected here, by design: only the background can tell,
// and it does — `signData` throws, SUPPORT_CHAT_AUTH replies `success:false`,
// `handshake()` reports `failed` and `send()` surfaces
// `support.error.sendFailed` in the dock's notice banner. Validating the
// password twice would mean decrypting the key in a UI context.
//
// Never logs the password or the key bytes, and only ever exposes an i18n KEY.
//
// Structural model: `useSupportChat.ts` — an injectable factory plus a singleton.

import { ref, type Ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { setSupportAuthPrompt, type SupportAuthInput } from './useSupportChat';

/** The wallet facts the prompt needs to choose which credential to ask for. */
export interface SupportAuthWallet {
  encryptionMethod?: string;
  prfEncryptedPrivateKey?: string;
  webAuthnCredentialId?: string;
}

export interface SupportAuthPrompt {
  /** The dialog is asking for credentials right now. */
  isOpen: Ref<boolean>;
  /** True when the active wallet authenticates with a PassKey instead of a password. */
  isPrf: Ref<boolean>;
  /** i18n KEY only — the dialog renders it. Cleared on every settle. */
  errorKey: Ref<string | null>;
  /** The hook itself: resolves credentials, or `null` when the user cancels. */
  open(): Promise<SupportAuthInput | null>;
  submitPassword(password: string): void;
  submitPrivateKeyBytes(bytes: Uint8Array | number[]): void;
  /** The PassKey ceremony failed: keep the dialog open with an inline message. */
  reportAuthError(): void;
  cancel(): void;
  /** Wire this prompt into `useSupportChat` (called by the dialog on mount). */
  register(): void;
  /** Unwire it, cancelling anything still awaiting it (called on unmount). */
  unregister(): void;
}

export interface SupportAuthPromptDeps {
  wallet?: () => SupportAuthWallet | null;
  setPrompt?: (prompt: (() => Promise<SupportAuthInput | null>) | null) => void;
}

/**
 * PRF/PassKey wallet detection — the exact rule RemoteSigningDialog.vue uses.
 * `encryptionMethod === 'prf'` is the modern marker; the credential-id + encrypted
 * key pair covers wallet records written before that field existed.
 *
 * Hardware and MPC wallets never reach this: `useSupportChat.isAvailable` already
 * restricts the whole feature to `WalletType.Normal`, which is exactly the set
 * split by this predicate.
 */
export function isPrfWallet(wallet: SupportAuthWallet | null): boolean {
  if (!wallet) return false;
  return (
    wallet.encryptionMethod === 'prf'
    || (!!wallet.prfEncryptedPrivateKey && !!wallet.webAuthnCredentialId)
  );
}

function defaultWallet(): SupportAuthWallet | null {
  return (walletStore.loggedWallet as SupportAuthWallet | null) ?? null;
}

export function createSupportAuthPrompt(deps: SupportAuthPromptDeps = {}): SupportAuthPrompt {
  const readWallet = deps.wallet ?? defaultWallet;
  const setPrompt = deps.setPrompt ?? setSupportAuthPrompt;

  const isOpen: Ref<boolean> = ref(false);
  const isPrf: Ref<boolean> = ref(false);
  const errorKey: Ref<string | null> = ref<string | null>(null);

  /** Resolver of the promise `open()` handed out, or null when nothing is waiting. */
  let pending: ((value: SupportAuthInput | null) => void) | null = null;

  /** Close the dialog and hand `value` to whoever is awaiting it. */
  function settle(value: SupportAuthInput | null): void {
    const resolve = pending;
    pending = null;
    isOpen.value = false;
    errorKey.value = null;
    resolve?.(value);
  }

  function open(): Promise<SupportAuthInput | null> {
    // `send()` serializes itself on `busy`, so a second open can only mean the
    // first one's caller is gone. Settle it as a cancel rather than dropping the
    // resolver on the floor and leaving that send awaiting forever.
    settle(null);
    // Snapshot the wallet's auth kind at open time: the dialog must not re-derive
    // it mid-prompt if the store re-points underneath it.
    isPrf.value = isPrfWallet(readWallet());
    isOpen.value = true;
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  function submitPassword(password: string): void {
    // The confirm button is disabled on an empty field too; this is the guard for
    // the Enter-key path.
    if (!password) return;
    settle({ password });
  }

  function submitPrivateKeyBytes(bytes: Uint8Array | number[]): void {
    // A plain array, not the Uint8Array: chrome messaging structured-clones a
    // typed array into an object, which the background could not read back.
    settle({ privateKeyBytes: Array.from(bytes) });
  }

  function reportAuthError(): void {
    // Keep the prompt open so the user can retry the ceremony or cancel out —
    // the same thing RemoteSigningDialog does with its inline enable error.
    if (!isOpen.value) return;
    errorKey.value = 'security.passKeyAuthFailed';
  }

  function cancel(): void {
    settle(null);
  }

  function register(): void {
    setPrompt(open);
  }

  function unregister(): void {
    setPrompt(null);
    // The dialog is going away; a send still awaiting it would hang forever.
    // Treat it as a cancel — the draft is kept and no error banner is shown.
    settle(null);
  }

  return {
    isOpen,
    isPrf,
    errorKey,
    open,
    submitPassword,
    submitPrivateKeyBytes,
    reportAuthError,
    cancel,
    register,
    unregister,
  };
}

/** Singleton wired up by `SupportAuthPrompt.vue`, one per UI context. */
export const supportAuthPrompt: SupportAuthPrompt = createSupportAuthPrompt();
