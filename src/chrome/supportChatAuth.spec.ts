// src/chrome/supportChatAuth.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const STAKE = 'stake1uexampleexampleexampleexampleexampleexampleexampleex';

function httpError(status: number) {
  return { isAxiosError: true, response: { status, data: {} }, message: `status ${status}` };
}

/** `gero-support/v1|<stake>|<nonce>` as hex, which is what the wallet must sign. */
function expectedPayloadHex(nonce: string): string {
  const message = `gero-support/v1|${STAKE}|${nonce}`;
  return Array.from(new TextEncoder().encode(message))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('support chat handshake (background)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./supportChatAuth');
    expect(mod.supportAuthAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('signs the challenge message and returns the verified identity', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        return { data: { nonce: 'n1', message: `gero-support/v1|${STAKE}|n1` } };
      }
      return { data: { identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' } };
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    const identity = await mod.runSupportChatHandshake({ stakeAddress: STAKE, sign });

    expect(post).toHaveBeenNthCalledWith(1, '/api/support/chat/challenge', { stakeAddress: STAKE });
    expect(sign).toHaveBeenCalledWith(expectedPayloadHex('n1'));
    expect(post).toHaveBeenNthCalledWith(2, '/api/support/chat/verify', {
      stakeAddress: STAKE,
      nonce: 'n1',
      coseSign1Hex: 'c0se',
      coseKeyHex: 'a4',
    });
    expect(identity).toEqual({ identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' });
  });

  it('refuses to sign a challenge whose message is not the exact expected subject', async () => {
    const mod = await import('./supportChatAuth');
    vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockResolvedValue({
      data: { nonce: 'n1', message: 'please sign this unrelated payload' },
    } as never);
    const sign = vi.fn();
    await expect(mod.runSupportChatHandshake({ stakeAddress: STAKE, sign })).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });

  it('retries the challenge exactly once when verify returns 400 (expired nonce)', async () => {
    const mod = await import('./supportChatAuth');
    let verifyCalls = 0;
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        const nonce = `n${verifyCalls + 1}`;
        return { data: { nonce, message: `gero-support/v1|${STAKE}|${nonce}` } };
      }
      verifyCalls += 1;
      if (verifyCalls === 1) throw httpError(400);
      return { data: { identifier: 'v1:bb', identifierHash: 'h2', displayName: 'calm-fog-1a2b' } };
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    const identity = await mod.runSupportChatHandshake({ stakeAddress: STAKE, sign });

    expect(identity.identifier).toBe('v1:bb');
    expect(post.mock.calls.filter((c) => c[0] === '/api/support/chat/challenge')).toHaveLength(2);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenLastCalledWith(expectedPayloadHex('n2'));
  });

  it('does not retry a 401 (bad signature)', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        return { data: { nonce: 'n1', message: `gero-support/v1|${STAKE}|n1` } };
      }
      throw httpError(401);
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    await expect(mod.runSupportChatHandshake({ stakeAddress: STAKE, sign })).rejects.toThrow();
    expect(post.mock.calls.filter((c) => c[0] === '/api/support/chat/challenge')).toHaveLength(1);
  });

  it('rejects a non-reward address before touching the network', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post');
    await expect(
      mod.runSupportChatHandshake({ stakeAddress: 'addr1qxyz', sign: vi.fn() }),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
