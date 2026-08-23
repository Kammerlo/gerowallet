/**
 * Pure logic behind the positions (cast votes) explorer.
 *
 * Kept out of the component so the honesty rules below are testable on their
 * own. Three of them are load-bearing:
 *
 *  1. Every optional field on `GovVote` is treated as ABSENT until proven
 *     present. Production's projection is not confirmed to carry `votedAt`,
 *     `rationaleUrl`, `hasScript` or the role-agnostic `voterId`, so absence
 *     hides the affordance rather than rendering a blank or a zero.
 *  2. Identity is matched on the DRep CREDENTIAL, never on the display string.
 *     The wallet holds one id form and a vote row may carry another.
 *  3. A truncated list cannot prove a vote is absent. "Your DRep has not voted"
 *     is a claim about the user, and it is only made from a complete list.
 */

import type { GovVote } from '@/api/governance.types';
import { KEYWORD_DREPS, parseDRepId, sameDRep } from '@/shared/utils/drepId';
import { safeExternalHref } from '@/shared/utils/externalLink';

/** Whose position the callout is about. Mirrors the store's `VoterIdentityKind`. */
export type PositionOwner = 'self' | 'delegated';

export interface PositionIdentity {
  /** Any DRep id form, or a keyword DRep. */
  drepId: string;
  kind: PositionOwner;
}

/** One vote row, normalised for rendering. Nothing here is ever a placeholder. */
export interface PositionRow {
  /** Stable v-for key. */
  key: string;
  role: string;
  /** Best identifier available: bech32 where upstream gave one, hex otherwise. */
  id: string;
  /** 28-byte credential of a DRep row — the only safe name-index key. Null otherwise. */
  credentialHex: string | null;
  drepId: string | null;
  vote: string;
  /** Unix seconds, or null when the projection does not carry a block time. */
  votedAt: number | null;
  /** Safe http(s) href of the voter's published rationale, or undefined. */
  rationaleHref: string | undefined;
  /** Only ever true from an explicit `true`. Unknown is not "not a script". */
  hasScript: boolean;
  isDRep: boolean;
}

export interface PositionSummary {
  total: number;
  yes: number;
  no: number;
  abstain: number;
  /** Counts per role, in a fixed order, omitting roles with no rows. */
  byRole: Array<{ role: string; count: number }>;
  withRationale: number;
  /** True when at least one row carries a block time, so ordering by date means something. */
  anyVotedAt: boolean;
}

export interface PositionFilters {
  search: string;
  role: string;
  choice: string;
  rationaleOnly: boolean;
}

export type PositionSort = 'newest' | 'oldest';

export type YourPosition =
  /** No delegation and no DRep of our own: nothing on this list is the user's. */
  | { kind: 'none' }
  /** Delegated to always-abstain / always-no-confidence: a standing position, never a row. */
  | { kind: 'keyword'; who: PositionOwner }
  | { kind: 'voted'; who: PositionOwner; row: PositionRow }
  | { kind: 'notVoted'; who: PositionOwner }
  /** The list is incomplete, so absence proves nothing. */
  | { kind: 'unknown'; who: PositionOwner };

/** Fixed display order. Not a ranking — all three bodies are equally common. */
export const ROLE_ORDER = ['DRep', 'SPO', 'ConstitutionalCommittee'] as const;

export const VOTE_CHOICES = ['Yes', 'No', 'Abstain'] as const;

function roleRank(role: string): number {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

/** A positive unix-seconds timestamp, or null. Epoch 0 is not a date, it is a missing field. */
function toVotedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function toPositionRows(votes: GovVote[]): PositionRow[] {
  return (votes ?? []).map((vote, i) => {
    const role = String(vote.voterRole ?? '');
    const isDRep = role === 'DRep';
    const id = String(vote.voterId || vote.drepId || vote.voterHash || '');
    // Only DRep rows get a credential: an SPO's `voterHash` is 56 hex too and
    // would parse, which would let a pool collide with a DRep in the name index.
    const credentialHex = isDRep ? (parseDRepId(vote.drepId || vote.voterHash)?.credentialHex ?? null) : null;
    return {
      key: `${role}:${id}:${i}`,
      role,
      id,
      credentialHex,
      drepId: vote.drepId ?? null,
      vote: String(vote.vote ?? ''),
      votedAt: toVotedAt(vote.votedAt),
      rationaleHref: safeExternalHref(vote.rationaleUrl),
      hasScript: vote.hasScript === true,
      isDRep,
    };
  });
}

/**
 * Head counts, one per voter.
 *
 * These are NOT the tally. Stake weight decides the outcome and lives on the
 * Overview tab; this counts voters. The two must never be presented as the same
 * number, which is why nothing here produces a percentage or a bar.
 */
export function summarizePositions(rows: PositionRow[]): PositionSummary {
  const byRole = new Map<string, number>();
  let yes = 0;
  let no = 0;
  let abstain = 0;
  let withRationale = 0;
  let anyVotedAt = false;

  for (const row of rows) {
    if (row.vote === 'Yes') yes += 1;
    else if (row.vote === 'No') no += 1;
    else if (row.vote === 'Abstain') abstain += 1;
    if (row.rationaleHref) withRationale += 1;
    if (row.votedAt !== null) anyVotedAt = true;
    if (row.role) byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1);
  }

  return {
    total: rows.length,
    yes,
    no,
    abstain,
    byRole: [...byRole.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    withRationale,
    anyVotedAt,
  };
}

/** Case-insensitive substring match over the voter's name and every id form it has. */
function matchesSearch(row: PositionRow, needle: string, name: string | null): boolean {
  const haystack = [name, row.id, row.drepId, row.credentialHex]
    .filter((v): v is string => !!v)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterPositions(
  rows: PositionRow[],
  filters: PositionFilters,
  nameOf: (row: PositionRow) => string | null = () => null,
): PositionRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(row => {
    if (filters.role !== 'all' && row.role !== filters.role) return false;
    if (filters.choice !== 'all' && row.vote !== filters.choice) return false;
    if (filters.rationaleOnly && !row.rationaleHref) return false;
    if (needle && !matchesSearch(row, needle, nameOf(row))) return false;
    return true;
  });
}

/**
 * Order by when the position was cast.
 *
 * Ordering by voting power is forbidden, permanently: it would make the list a
 * ranking. The data does not even carry per-voter power, so the rule is
 * enforced by absence as well as by policy. Rows with no timestamp sort LAST as
 * a block rather than being interleaved by guess.
 */
export function sortPositions(rows: PositionRow[], order: PositionSort): PositionRow[] {
  const direction = order === 'oldest' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.votedAt === null && b.votedAt === null) return roleRank(a.role) - roleRank(b.role) || a.id.localeCompare(b.id);
    if (a.votedAt === null) return 1;
    if (b.votedAt === null) return -1;
    if (a.votedAt !== b.votedAt) return (b.votedAt - a.votedAt) * direction;
    return roleRank(a.role) - roleRank(b.role) || a.id.localeCompare(b.id);
  });
}

/** True when this row is the DRep the wallet votes through. */
export function isYourRow(row: PositionRow, identity: PositionIdentity | null): boolean {
  if (!identity || !row.isDRep) return false;
  if ((KEYWORD_DREPS as readonly string[]).includes(identity.drepId)) return false;
  return sameDRep(row.drepId || row.id, identity.drepId);
}

/**
 * What can honestly be said about the user's own position on this action.
 *
 * `complete` is the guard that keeps this from lying: with a truncated list, a
 * missing row means "not found in the part we loaded", not "did not vote".
 */
export function resolveYourPosition(
  rows: PositionRow[],
  identity: PositionIdentity | null,
  complete: boolean,
): YourPosition {
  if (!identity?.drepId) return { kind: 'none' };
  if ((KEYWORD_DREPS as readonly string[]).includes(identity.drepId)) {
    return { kind: 'keyword', who: identity.kind };
  }
  const row = rows.find(candidate => isYourRow(candidate, identity));
  if (row) return { kind: 'voted', who: identity.kind, row };
  return complete ? { kind: 'notVoted', who: identity.kind } : { kind: 'unknown', who: identity.kind };
}
