/**
 * Governance action lifecycle helpers.
 *
 * Epoch arithmetic only — this module deliberately does NOT convert an epoch to
 * a calendar date. Doing that needs a per-network (epoch, startTime) anchor, and
 * a wrong anchor silently shifts every date on the page. If a date is wanted,
 * derive the anchor from data the wallet already syncs (the chain tip carries
 * both the current epoch and a timestamp) rather than hardcoding one.
 */

/** A Cardano epoch is 432,000 seconds. */
export const EPOCH_LENGTH_DAYS = 5;

export type StatusTone = 'success' | 'info' | 'warning' | 'neutral';

/** Whole epochs from `currentEpoch` until `expiresEpoch`; 0 once passed. */
export function epochsRemaining(
  currentEpoch: number | null | undefined,
  expiresEpoch: number | null | undefined,
): number | null {
  if (currentEpoch === null || currentEpoch === undefined) return null;
  if (expiresEpoch === null || expiresEpoch === undefined) return null;
  return Math.max(0, expiresEpoch - currentEpoch);
}

/**
 * Approximate days left. This is epochs × 5 — a whole-epoch approximation, not
 * a countdown, because we do not know how far into the current epoch we are.
 * Label it "about N days" in the UI.
 */
export function daysRemaining(
  currentEpoch: number | null | undefined,
  expiresEpoch: number | null | undefined,
): number | null {
  const epochs = epochsRemaining(currentEpoch, expiresEpoch);
  return epochs === null ? null : epochs * EPOCH_LENGTH_DAYS;
}

/** Semantic tone for a status pill. Unknown statuses degrade to neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  switch (String(status ?? '').toLowerCase()) {
    case 'enacted':
    case 'ratified':
      return 'success';
    case 'active':
      return 'info';
    case 'expired':
    case 'dropped':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** True when an action is still open to votes. */
export function isOpen(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'active';
}
