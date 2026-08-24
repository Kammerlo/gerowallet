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
 * empty string instead (older indexer schemas), so both mean "native". The
 * check is deliberately loose: it accepts an all-zero string of ANY length,
 * not just the canonical 64 hex chars.
 *
 * This is now the single canonical predicate — both `midnight-sync.service.ts`
 * (the CATCH_UP snapshot re-sum and the former `isNightOutput` helper) and
 * `midnightStore.ts` (`applyUtxoDeltas`'s `isNight` closure) import and call
 * this function directly rather than keeping their own copies.
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
  // tokenType comes straight from an unvalidated third-party indexer, so a
  // color equal to "constructor"/"__proto__"/etc. must not collide with
  // Object.prototype — a null-prototype object avoids both the inherited-value
  // read (which would silently produce a string instead of a bigint) and the
  // silent-no-op write on `__proto__` (which would drop that color entirely).
  const balances: Record<string, bigint> = Object.create(null);
  for (const u of utxos) {
    const tokenType = u.tokenType ?? '';
    if (isNativeNight(tokenType)) continue;
    balances[tokenType] = (balances[tokenType] ?? 0n) + u.value;
  }
  return balances;
}
