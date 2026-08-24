/**
 * One vocabulary for governance action types, statuses, voter roles and vote
 * choices, whatever spelling the projection in front of us uses.
 *
 * This exists because a real mismatch shipped: the wallet's types were written
 * against the Koios-shaped local dev shim (`TreasuryWithdrawals`, `active`),
 * while production Nexus answers in SCREAMING_SNAKE
 * (`TREASURY_WITHDRAWALS_ACTION`, `LIVE`) — verified 2026-08-24 against
 * api.gerowallet.io and the market-site proxy, which agree with each other and
 * disagree with the shim. Nothing in `src/` normalised them, so pointing a
 * build at production degraded every action surface silently: `isInfoAction`
 * never fired, `isOpen` never saw a live action, and `evaluateThresholds` was
 * handed a type it did not recognise, so no tally card rendered at all. Silent,
 * because every one of those failures reads as "nothing to show" rather than
 * as an error.
 *
 * The wallet's own spelling stays the internal one — it is what the components,
 * the i18n keys and the specs already use. This module is the boundary that
 * maps everything onto it, applied once on ingest in `governance-api.ts`.
 *
 * Rules that keep it honest:
 *  - An UNRECOGNISED value passes through untouched rather than being coerced
 *    into a neighbour. A new CIP-1694 action type must show up as itself (and
 *    fail loudly in a threshold lookup) instead of being quietly filed as an
 *    InfoAction, which would tell a reader an action cannot ratify when it can.
 *  - Matching ignores case, underscores and the `_ACTION` suffix, so a
 *    projection that changes its mind about `NEW_COMMITTEE` vs `UPDATE_COMMITTEE`
 *    keeps working without another release.
 */

import type { GovActionStatus, GovActionType, VoteChoice, VoterRole } from '@/api/governance.types';

/** Lower-case, strip underscores and a trailing "action", so all spellings collapse. */
function fold(value: string): string {
  return value.toLowerCase().replace(/_/g, '').replace(/action$/, '');
}

function lookup<T extends string>(table: Record<string, T>, value: unknown): T | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return table[fold(trimmed)] ?? null;
}

/**
 * Folded spelling to the wallet's own. Both the Nexus and the shim spellings
 * fold to the same key, so one entry covers both.
 *
 * `updatecommittee` and `newcommittee` are the same CIP-1694 action: the ledger
 * calls it UpdateCommittee, Nexus answers `UPDATE_COMMITTEE`, and the wallet
 * has always called it NewCommittee. Both fold here rather than renaming a type
 * every consumer and spec already uses.
 */
const TYPES: Record<string, GovActionType> = {
  parameterchange: 'ParameterChange',
  hardforkinitiation: 'HardForkInitiation',
  treasurywithdrawals: 'TreasuryWithdrawals',
  noconfidence: 'NoConfidence',
  newcommittee: 'NewCommittee',
  updatecommittee: 'NewCommittee',
  newconstitution: 'NewConstitution',
  info: 'InfoAction',
};

/**
 * `live` is Nexus's word for what the wallet calls `active`. The other four
 * differ only in case.
 */
const STATUSES: Record<string, GovActionStatus> = {
  live: 'active',
  active: 'active',
  ratified: 'ratified',
  enacted: 'enacted',
  expired: 'expired',
  dropped: 'dropped',
};

const ROLES: Record<string, VoterRole> = {
  drep: 'DRep',
  drepkeyhash: 'DRep',
  drepscripthash: 'DRep',
  spo: 'SPO',
  stakingpoolkeyhash: 'SPO',
  constitutionalcommittee: 'ConstitutionalCommittee',
  constitutionalcommitteehotkeyhash: 'ConstitutionalCommittee',
  constitutionalcommitteehotscripthash: 'ConstitutionalCommittee',
};

const CHOICES: Record<string, VoteChoice> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstain',
};

/** Normalise an action type; unrecognised values pass through unchanged. */
export function normalizeActionType<T>(value: T): T | GovActionType {
  return lookup(TYPES, value) ?? value;
}

/** Normalise a lifecycle status; unrecognised values pass through unchanged. */
export function normalizeActionStatus<T>(value: T): T | GovActionStatus {
  return lookup(STATUSES, value) ?? value;
}

/** Normalise a voter role; unrecognised values pass through unchanged. */
export function normalizeVoterRole<T>(value: T): T | VoterRole {
  return lookup(ROLES, value) ?? value;
}

/** Normalise a ballot; unrecognised values pass through unchanged. */
export function normalizeVoteChoice<T>(value: T): T | VoteChoice {
  return lookup(CHOICES, value) ?? value;
}

/** Apply the type and status vocabulary to one proposal-shaped row, in place of a copy. */
export function normalizeProposal<T extends { type?: unknown; status?: unknown }>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  return { ...row, type: normalizeActionType(row.type), status: normalizeActionStatus(row.status) };
}

/** Apply the role and choice vocabulary to one vote-shaped row. */
export function normalizeVote<T extends { voterRole?: unknown; vote?: unknown }>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  return { ...row, voterRole: normalizeVoterRole(row.voterRole), vote: normalizeVoteChoice(row.vote) };
}
