/**
 * Which tooltip explains a locked (CIP-113) holdings row. Two different things carry
 * `isProgrammable`: the programmable token itself, which Gero will not build a transfer
 * for, and the ADA riding along in its UTxO — ordinary ADA that is merely stuck there,
 * priced and counted in the portfolio total unlike the token. Returns the key rather than
 * the string so templates can call it directly.
 */
export function programmableTooltipKey(unit: string): string {
  return unit === 'lovelace'
    ? 'programmableTokens.lockedAdaTooltip'
    : 'programmableTokens.badgeTooltip';
}
