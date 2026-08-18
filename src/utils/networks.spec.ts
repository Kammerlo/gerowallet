// src/utils/networks.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Blockchain, Network } from '@/models/types';

// networks.ts reads its CIP-113 env vars at module scope, so every case needs a
// fresh module instance — hence vi.resetModules() alongside vi.stubEnv().
const VALID_PREPROD = 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d';

async function loadNetworks() {
  const mod = await import('./networks');
  return mod.default;
}

describe('networks — CIP-113 programmable token configuration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exposes a configured base script hash and derives support from it', async () => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', VALID_PREPROD);
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([VALID_PREPROD]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(true);
  });

  it('treats an unset variable as unsupported', async () => {
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('treats an explicitly empty variable the same as an unset one', async () => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', '');
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  // The configured hash is taken as granted — no on-chain check, no allowlist —
  // so the format check is the only guard against a mis-pasted trust anchor.
  // Each of these must fail closed rather than become a wrong base script.
  it.each([
    ['too short', VALID_PREPROD.slice(0, 40)],
    ['too long', `${VALID_PREPROD}ab`],
    ['0x-prefixed', `0x${VALID_PREPROD}`],
    ['bech32 address', 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'],
    ['non-hex characters', 'z'.repeat(56)],
  ])('rejects a malformed hash (%s) as unconfigured', async (_label, value) => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', value);
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('normalizes surrounding whitespace and uppercase hex', async () => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', `  ${VALID_PREPROD.toUpperCase()}  `);
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([VALID_PREPROD]);
  });

  it('keeps networks independent — configuring preprod does not enable mainnet', async () => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', VALID_PREPROD);
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.MAINNET)).toBe(false);
    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
  });

  it('reports unsupported for non-Cardano chains and for missing arguments', async () => {
    vi.stubEnv('VITE_CIP113_PROGRAMMABLE_LOGIC_BASE_PREPROD', VALID_PREPROD);
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableTokenSupport(Blockchain.BITCOIN, Network.TESTNET)).toBe(false);
    expect(networks.resolveProgrammableTokenSupport('', '')).toBe(false);
    expect(networks.resolveProgrammableLogicBaseScriptHashes('', '')).toEqual([]);
  });
});

describe('cip68Label — CIP-67 prefix decoding', () => {
  it('identifies each CIP-67 label', async () => {
    const { cip68Label } = await import('@/shared/utils/resolver');
    const name = '54657374313233'; // "Test123"
    expect(cip68Label(`000643b0${name}`)).toBe(100); // reference token — filtered from holdings
    expect(cip68Label(`000de140${name}`)).toBe(222); // NFT
    expect(cip68Label(`0014df10${name}`)).toBe(333); // FT
  });

  it('returns null for an unlabelled asset name and for a bad checksum', async () => {
    const { cip68Label } = await import('@/shared/utils/resolver');
    expect(cip68Label('54657374313233')).toBeNull();
    expect(cip68Label('000643ff54657374313233')).toBeNull();
    expect(cip68Label('')).toBeNull();
    expect(cip68Label(undefined)).toBeNull();
  });
});
