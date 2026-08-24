/**
 * Per-color balance derivation for Midnight unshielded UTxOs.
 *
 * Every UTxO the wallet stores already carries `tokenType`, so per-color
 * balances are DERIVED, never stored — there is no new state to keep in sync
 * and nothing extra to broadcast across contexts.
 *
 * Native NIGHT is deliberately excluded here. It has its own balance field
 * (`MidnightBalances.nightUnshielded`) maintained by the sync service, and
 * that field has twice been zeroed by regressions; nothing in this module
 * writes to it.
 */
import type { MidnightUnshieldedUtxo } from './midnightTypes';

/**
 * Native NIGHT is the 32-byte-zero token type. gero-sync sometimes emits an
 * empty string instead (older indexer schemas), so both mean "native".
 */
export function isNativeNight(tokenType: string | undefined | null): boolean {
  const tt = tokenType ?? '';
  return tt === '' || /^0+$/.test(tt);
}

/**
 * Sum unshielded UTxOs per non-native token color.
 *
 * @returns map of token color → balance in base units. Empty when the wallet
 *          holds only NIGHT. Callers must divide by the token's decimals,
 *          which come from metadata and may be unknown.
 */
export function midnightTokenBalances(
  utxos: ReadonlyArray<MidnightUnshieldedUtxo>,
): Record<string, bigint> {
  const balances: Record<string, bigint> = {};
  for (const u of utxos) {
    const tokenType = u.tokenType ?? '';
    if (isNativeNight(tokenType)) continue;
    balances[tokenType] = (balances[tokenType] ?? 0n) + u.value;
  }
  return balances;
}
