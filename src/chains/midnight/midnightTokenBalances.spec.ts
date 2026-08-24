import { describe, it, expect } from 'vitest';
import { isNativeNight, midnightTokenBalances } from './midnightTokenBalances';
import type { MidnightUnshieldedUtxo } from './midnightTypes';

const USDM = '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b';
const NIGHT_ZERO = '0'.repeat(64);

function utxo(tokenType: string, value: bigint, outputIndex = 0): MidnightUnshieldedUtxo {
  return {
    owner: 'mn_addr1test',
    tokenType,
    value,
    intentHash: `intent${outputIndex}`,
    outputIndex,
    initialNonce: '',
    registeredForDustGeneration: false,
  };
}

describe('isNativeNight', () => {
  it('treats empty and all-zero token types as native NIGHT', () => {
    expect(isNativeNight('')).toBe(true);
    expect(isNativeNight(undefined)).toBe(true);
    expect(isNativeNight(NIGHT_ZERO)).toBe(true);
  });

  it('treats a real token color as non-native', () => {
    expect(isNativeNight(USDM)).toBe(false);
  });

  it('accepts all-zero strings of any length, and null', () => {
    expect(isNativeNight('0')).toBe(true);
    expect(isNativeNight('00')).toBe(true);
    expect(isNativeNight(null)).toBe(true);
    expect(isNativeNight('0'.repeat(63))).toBe(true);
  });
});

describe('midnightTokenBalances', () => {
  it('returns an empty map when the wallet holds only NIGHT', () => {
    expect(midnightTokenBalances([utxo(NIGHT_ZERO, 100n), utxo('', 50n, 1)])).toEqual({});
  });

  it('sums a single non-native color', () => {
    expect(midnightTokenBalances([utxo(USDM, 5000000n)])).toEqual({ [USDM]: 5000000n });
  });

  it('sums multiple UTxOs of the same color and excludes NIGHT', () => {
    const result = midnightTokenBalances([
      utxo(USDM, 5000000n, 0),
      utxo(USDM, 2500000n, 1),
      utxo(NIGHT_ZERO, 999n, 2),
    ]);
    expect(result).toEqual({ [USDM]: 7500000n });
  });

  it('keeps distinct colors separate', () => {
    const other = 'ab'.repeat(32);
    const result = midnightTokenBalances([utxo(USDM, 1n, 0), utxo(other, 2n, 1)]);
    expect(result).toEqual({ [USDM]: 1n, [other]: 2n });
  });

  it('returns an empty map for an empty UTxO set', () => {
    expect(midnightTokenBalances([])).toEqual({});
  });

  it('handles token colors that collide with Object.prototype keys', () => {
    const result = midnightTokenBalances([
      utxo('__proto__', 7n, 0),
      utxo('constructor', 9n, 1),
    ]);
    expect(result['__proto__']).toBe(7n);
    expect(result['constructor']).toBe(9n);
    expect(Object.entries(result)).toHaveLength(2);
  });
});

describe('NIGHT balance isolation', () => {
  it('a non-native color contributes nothing to a native-NIGHT sum', () => {
    // Mirrors the filter both balance paths apply (delta path in
    // midnightStore.applyUtxoDeltas, snapshot path in midnight-sync.service).
    // If either drops its filter, USDM would inflate nightUnshielded.
    const set = [utxo(NIGHT_ZERO, 100n, 0), utxo(USDM, 5000000n, 1), utxo('', 25n, 2)];
    const night = set.filter(u => isNativeNight(u.tokenType)).reduce((s, u) => s + u.value, 0n);
    expect(night).toBe(125n);
    expect(midnightTokenBalances(set)).toEqual({ [USDM]: 5000000n });
  });
});
