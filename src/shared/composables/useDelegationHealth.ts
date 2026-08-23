import { computed, unref, type ComputedRef, type Ref } from 'vue';
import { epochsRemaining } from '@/shared/utils/govLifecycle';
import { pctOf } from '@/shared/utils/lovelace';

/**
 * Health of the DRep a wallet has delegated its voting power to.
 *
 * Pure over its arguments: this module NEVER fetches. The caller supplies the
 * DRep record (gero-backend `GET /api/dreps/{id}`, snake_case) and the current
 * epoch (`networkStore.getCurrentEpoch()`), so the same maths is reusable from
 * a view, from an alert evaluator, and from a test with no store at all.
 *
 * Two CIP-1694 facts drive everything here:
 *
 *  - A DRep that does not vote for `drep_activity` epochs stops counting. The
 *    node tracks this as `expires_epoch_no`, which it pushes forward on every
 *    vote — so `expires_epoch_no − currentEpoch` is the authoritative countdown
 *    and "epochs since the last vote" is derived FROM it, not from `votes[]`.
 *    Deriving it the other way round is wrong: registration and delegation
 *    changes also move the expiry.
 *  - Delegated stake behind an expired DRep is excluded from every tally until
 *    that DRep votes again. That is why the warning exists at all.
 *
 * `n/a` is not `0`. A DRep with no votes has NO rationale rate — reporting 0%
 * would accuse them of withholding rationales they were never asked for. Those
 * fields are `null` and the UI must render them as "n/a".
 */

/** One row of the DRep's voting record, as gero-backend returns it. */
export interface DRepVoteRecord {
  proposal_id?: string | null;
  vote?: string | null;
  /** Unix seconds. Absent on some providers, so it is treated as unordered. */
  block_time?: number | null;
  /** The CIP-136 rationale anchor. Non-empty means a rationale was attached. */
  meta_url?: string | null;
  meta_hash?: string | null;
}

/**
 * The delegated DRep as gero-backend returns it. Structurally typed and fully
 * optional: the endpoint is untyped upstream (`blockchain-api.getDRepById`
 * returns `any` and `null` on 404), and every field here has been seen absent.
 *
 * `registered` and `active` are distinct and both matter: `registered: false`
 * is retirement (a deregistration certificate), while `active: false` is an
 * expiry through inactivity. Only the first is permanent.
 */
export interface DelegatedDRepRecord {
  drep_id?: string | null;
  registered?: boolean | null;
  active?: boolean | null;
  expires_epoch_no?: number | null;
  votes?: DRepVoteRecord[] | null;
  delegators?: unknown[] | null;
  metadata?: unknown;
}

export interface DelegationHealthOptions {
  /** `networkStore.getCurrentEpoch()`. Null on a Bitcoin tip or before sync. */
  currentEpoch?: number | null;
  /**
   * The protocol's `drep_activity`. On `networkStore.epochParams` this is the
   * Cardano SDK's `dRepInactivityPeriod` (camelCase); the raw gero-backend
   * epoch-params payload spells it `drep_activity`. Null falls back to 20.
   */
  activityWindow?: number | null;
  /** Warn once this many epochs (or fewer) remain. */
  warnAt?: number;
  /** How many of the newest votes `rationaleRecent` covers. */
  recentWindow?: number;
}

export interface DelegationHealth {
  /** Whole epochs until the DRep goes inactive; 0 once passed, null if unknown. */
  epochsLeft: number | null;
  /** `activityWindow − epochsLeft`, i.e. how far into the window they are. */
  epochsSinceVote: number | null;
  /** The window actually used, after the `drep_activity` fallback. */
  activityWindow: number;
  /** The epochs-left threshold actually used. */
  warnAt: number;
  /** Going inactive (or already there) and not retired: the amber state. */
  inactiveSoon: boolean;
  /** Already stopped counting — expired window, or an explicit `active: false`. */
  expired: boolean;
  /** Deregistered on-chain. Permanent, and it outranks the inactivity warning. */
  retired: boolean;
  /** Percent (0–100) of the newest `recentWindow` votes carrying a rationale, or null. */
  rationaleRecent: number | null;
  /** Percent (0–100) over the whole voting record, or null when there are no votes. */
  rationaleLongRun: number | null;
  /** The window actually used for `rationaleRecent`. */
  recentWindow: number;
  /** How many votes the record carried. */
  voteCount: number;
  /** Unix seconds of the newest vote, or null when unknown. */
  lastVoteAt: number | null;
}

/** CIP-1694's default `drep_activity`, used when the epoch params do not carry one. */
export const DEFAULT_DREP_ACTIVITY_EPOCHS = 20;
/** Warn with 5 epochs (about 25 days) left — the 15-of-20 point the alerts surface names. */
export const DEFAULT_WARN_EPOCHS_LEFT = 5;
/** "Their last 10 votes" is the recency window the DRep surfaces quote. */
export const DEFAULT_RATIONALE_WINDOW = 10;

/** A value, a ref of it, or a getter for it — so callers can stay reactive or not. */
export type HealthSource<T> = T | Ref<T> | (() => T);

function read<T>(source: HealthSource<T>): T {
  return typeof source === 'function' ? (source as () => T)() : (unref(source as T | Ref<T>) as T);
}

function hasRationale(entry: DRepVoteRecord): boolean {
  return String(entry.meta_url ?? '').trim().length > 0;
}

/**
 * Newest first. `block_time` is optional upstream, so undated votes sort last
 * rather than poisoning the order — they still count toward the long-run rate.
 */
function newestFirst(entries: DRepVoteRecord[]): DRepVoteRecord[] {
  return [...entries].sort((a, b) => (b.block_time ?? -Infinity) - (a.block_time ?? -Infinity));
}

/** Percent of `entries` carrying a rationale, or null when there are none to judge. */
function rationaleRate(entries: DRepVoteRecord[]): number | null {
  if (entries.length === 0) return null;
  return pctOf(entries.filter(hasRationale).length, entries.length);
}

/** Compute the health of one delegated DRep. Pure — safe to call in a render. */
export function delegationHealth(
  record: DelegatedDRepRecord | null | undefined,
  options: DelegationHealthOptions = {},
): DelegationHealth {
  const activityWindow = options.activityWindow ?? DEFAULT_DREP_ACTIVITY_EPOCHS;
  const warnAt = options.warnAt ?? DEFAULT_WARN_EPOCHS_LEFT;
  const recentWindow = options.recentWindow ?? DEFAULT_RATIONALE_WINDOW;

  // `epochsRemaining` clamps at 0, so an over-expired DRep reads "0 left" rather
  // than a negative countdown; `expired` carries the fact that it is past due.
  const epochsLeft = epochsRemaining(options.currentEpoch, record?.expires_epoch_no);
  const epochsSinceVote = epochsLeft === null ? null : Math.min(activityWindow, activityWindow - epochsLeft);

  const retired = record?.registered === false;
  const expired = !retired && (record?.active === false || (epochsLeft !== null && epochsLeft <= 0));
  const inactiveSoon = !retired && (expired || (epochsLeft !== null && epochsLeft <= warnAt));

  const ordered = newestFirst(record?.votes ?? []);

  return {
    epochsLeft,
    epochsSinceVote,
    activityWindow,
    warnAt,
    inactiveSoon,
    expired,
    retired,
    rationaleRecent: rationaleRate(ordered.slice(0, Math.max(0, recentWindow))),
    rationaleLongRun: rationaleRate(ordered),
    recentWindow,
    voteCount: ordered.length,
    lastVoteAt: ordered[0]?.block_time ?? null,
  };
}

/**
 * Reactive wrapper. Both arguments accept a value, a ref or a getter, so the
 * caller decides what is reactive — typically the record (it arrives async) and
 * the current epoch (it advances under the user).
 */
export function useDelegationHealth(
  record: HealthSource<DelegatedDRepRecord | null | undefined>,
  options: HealthSource<DelegationHealthOptions> = {},
): ComputedRef<DelegationHealth> {
  return computed(() => delegationHealth(read(record), read(options)));
}
