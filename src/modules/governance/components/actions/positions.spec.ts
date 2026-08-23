// What is pinned here is HONESTY, not layout. Every case below is one where a
// convenient default would state something false about the user or about the
// voters: a missing timestamp rendered as a date, a truncated list read as
// "your DRep did not vote", a head count presented as a tally, or a DRep
// matched by display string so the same credential in another encoding misses.
import { describe, it, expect } from 'vitest';
import {
  filterPositions,
  isYourRow,
  resolveYourPosition,
  sortPositions,
  summarizePositions,
  toPositionRows,
} from './positions';
import type { PositionFilters } from './positions';
import { toCip129 } from '@/shared/utils/drepId';
import type { GovVote } from '@/api/governance.types';

const CRED_A = 'aa'.repeat(28);
const CRED_B = 'bb'.repeat(28);
const DREP_A = toCip129(CRED_A) as string;
const DREP_B = toCip129(CRED_B) as string;

function vote(over: Partial<GovVote> = {}): GovVote {
  return {
    voterRole: 'DRep',
    voterHash: CRED_A,
    drepId: DREP_A,
    vote: 'Yes',
    txHash: null,
    ...over,
  };
}

const NO_FILTERS: PositionFilters = { search: '', role: 'all', choice: 'all', rationaleOnly: false };

describe('toPositionRows', () => {
  it('treats every optional field as absent until it is actually present', () => {
    // This is the production shape today: Nexus's projection is not confirmed
    // to carry any of the four extras.
    const [row] = toPositionRows([vote()]);
    expect(row.votedAt).toBeNull();
    expect(row.rationaleHref).toBeUndefined();
    expect(row.hasScript).toBe(false);
  });

  it('reads the extras through when the projection does carry them', () => {
    const [row] = toPositionRows([
      vote({ votedAt: 1787463005, rationaleUrl: 'https://example.test/why.json', hasScript: true }),
    ]);
    expect(row.votedAt).toBe(1787463005);
    expect(row.rationaleHref).toBe('https://example.test/why.json');
    expect(row.hasScript).toBe(true);
  });

  it('refuses epoch 0 as a date', () => {
    // A zeroed block time is a missing field, not 1 January 1970.
    expect(toPositionRows([vote({ votedAt: 0 })])[0].votedAt).toBeNull();
  });

  it('drops a rationale link that is not a safe http(s) url', () => {
    // Rationale anchors are author-controlled, so the scheme is theirs to pick.
    const rows = toPositionRows([
      vote({ rationaleUrl: 'javascript:alert(1)' }),
      vote({ rationaleUrl: 'ipfs://QmSomething' }),
    ]);
    expect(rows[0].rationaleHref).toBeUndefined();
    expect(rows[1].rationaleHref).toBeUndefined();
  });

  it('only claims a script voter on an explicit true', () => {
    // Unknown is not "not a script": the marker renders in the positive only.
    expect(toPositionRows([vote({ hasScript: null })])[0].hasScript).toBe(false);
    expect(toPositionRows([vote({ hasScript: undefined })])[0].hasScript).toBe(false);
  });

  it('uses the role-agnostic voter id so an SPO is not left showing raw hex', () => {
    const [row] = toPositionRows([
      vote({ voterRole: 'SPO', drepId: null, voterHash: 'ff'.repeat(28), voterId: 'pool1ahazpr2yz5gljk2m4' }),
    ]);
    expect(row.id).toBe('pool1ahazpr2yz5gljk2m4');
    expect(row.isDRep).toBe(false);
    // A pool hash is 56 hex too, so it must never land in the DRep name index.
    expect(row.credentialHex).toBeNull();
  });

  it('keys a DRep row on its credential, whichever id form arrived', () => {
    const bech32 = toPositionRows([vote({ drepId: DREP_A })])[0];
    const hex = toPositionRows([vote({ drepId: CRED_A })])[0];
    expect(bech32.credentialHex).toBe(CRED_A);
    expect(hex.credentialHex).toBe(CRED_A);
  });
});

describe('summarizePositions', () => {
  it('counts voters, one per row, and never produces a percentage', () => {
    const summary = summarizePositions(
      toPositionRows([
        vote({ vote: 'Yes' }),
        vote({ vote: 'Yes' }),
        vote({ vote: 'No' }),
        vote({ vote: 'Abstain' }),
      ]),
    );
    expect(summary).toMatchObject({ total: 4, yes: 2, no: 1, abstain: 1 });
    // Head counts are not the tally; nothing here may be mistaken for one.
    expect(Object.keys(summary)).not.toContain('yesPct');
  });

  it('omits a body with no rows rather than reporting it as zero', () => {
    // SPOs cannot vote on a treasury withdrawal at all. "SPOs 0" would misread
    // ineligibility as abstention.
    const summary = summarizePositions(
      toPositionRows([vote(), vote({ voterRole: 'ConstitutionalCommittee', drepId: null })]),
    );
    expect(summary.byRole.map(entry => entry.role)).toEqual(['DRep', 'ConstitutionalCommittee']);
  });

  it('counts rationales and reports whether ordering by date is even possible', () => {
    const none = summarizePositions(toPositionRows([vote(), vote()]));
    expect(none.withRationale).toBe(0);
    expect(none.anyVotedAt).toBe(false);

    const some = summarizePositions(
      toPositionRows([vote({ rationaleUrl: 'https://a.test/x', votedAt: 100 }), vote()]),
    );
    expect(some.withRationale).toBe(1);
    expect(some.anyVotedAt).toBe(true);
  });
});

describe('sortPositions', () => {
  it('orders by when the position was cast, newest first by default', () => {
    const rows = toPositionRows([
      vote({ votedAt: 100, drepId: DREP_A }),
      vote({ votedAt: 300, drepId: DREP_B }),
      vote({ votedAt: 200, drepId: null, voterHash: 'cc'.repeat(28) }),
    ]);
    expect(sortPositions(rows, 'newest').map(r => r.votedAt)).toEqual([300, 200, 100]);
    expect(sortPositions(rows, 'oldest').map(r => r.votedAt)).toEqual([100, 200, 300]);
  });

  it('parks undated rows at the end rather than interleaving them by guess', () => {
    const rows = toPositionRows([
      vote({ drepId: DREP_A }),
      vote({ votedAt: 300, drepId: DREP_B }),
      vote({ votedAt: 100, drepId: null, voterHash: 'cc'.repeat(28) }),
    ]);
    expect(sortPositions(rows, 'newest').map(r => r.votedAt)).toEqual([300, 100, null]);
    // Even reversed, the unknowns stay last: they are not "the oldest".
    expect(sortPositions(rows, 'oldest').map(r => r.votedAt)).toEqual([100, 300, null]);
  });

  it('does not mutate the input', () => {
    const rows = toPositionRows([vote({ votedAt: 100 }), vote({ votedAt: 300 })]);
    sortPositions(rows, 'newest');
    expect(rows.map(r => r.votedAt)).toEqual([100, 300]);
  });
});

describe('filterPositions', () => {
  const rows = toPositionRows([
    vote({ voterRole: 'DRep', drepId: DREP_A, vote: 'Yes', rationaleUrl: 'https://a.test/x' }),
    vote({ voterRole: 'SPO', drepId: null, voterHash: 'cc'.repeat(28), voterId: 'pool1abc', vote: 'No' }),
    vote({ voterRole: 'ConstitutionalCommittee', drepId: null, voterHash: 'dd'.repeat(28), vote: 'Abstain' }),
  ]);

  it('filters by body and by choice independently', () => {
    expect(filterPositions(rows, { ...NO_FILTERS, role: 'SPO' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, choice: 'Abstain' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, role: 'SPO', choice: 'Yes' })).toHaveLength(0);
  });

  it('filters to rows that published a rationale', () => {
    expect(filterPositions(rows, { ...NO_FILTERS, rationaleOnly: true })).toHaveLength(1);
  });

  it('searches the resolved name as well as every id form', () => {
    const nameOf = (row: { credentialHex: string | null }) =>
      row.credentialHex === 'aa'.repeat(28) ? 'CryptoCrow' : null;
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'cryptocrow' }, nameOf)).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'pool1abc' })).toHaveLength(1);
    // The raw credential is searchable even when the row displays bech32.
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'aaaaaa' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'nothing here' })).toHaveLength(0);
  });
});

describe('isYourRow / resolveYourPosition', () => {
  it('matches the credential, not the display string', () => {
    // The wallet holds one id form and the vote row may carry another; a string
    // compare would report "has not voted" about a vote that is right there.
    const [row] = toPositionRows([vote({ drepId: DREP_A })]);
    expect(isYourRow(row, { drepId: CRED_A, kind: 'delegated' })).toBe(true);
    expect(isYourRow(row, { drepId: DREP_B, kind: 'delegated' })).toBe(false);
  });

  it('never matches an SPO or committee row, whose drepId is null', () => {
    const [row] = toPositionRows([vote({ voterRole: 'SPO', drepId: null, voterHash: CRED_A })]);
    expect(isYourRow(row, { drepId: DREP_A, kind: 'delegated' })).toBe(false);
  });

  it('says nothing at all when the wallet has no voting identity', () => {
    expect(resolveYourPosition(toPositionRows([vote()]), null, true)).toEqual({ kind: 'none' });
  });

  it('reports the vote when the delegated DRep is on the list', () => {
    const rows = toPositionRows([vote({ drepId: DREP_B, vote: 'No' }), vote({ drepId: DREP_A, vote: 'Yes' })]);
    const result = resolveYourPosition(rows, { drepId: CRED_A, kind: 'delegated' }, true);
    expect(result.kind).toBe('voted');
    if (result.kind === 'voted') {
      expect(result.row.vote).toBe('Yes');
      expect(result.who).toBe('delegated');
    }
  });

  it('distinguishes voting as yourself from voting through a DRep', () => {
    const rows = toPositionRows([vote({ drepId: DREP_A })]);
    expect(resolveYourPosition(rows, { drepId: DREP_A, kind: 'self' }, true).who).toBe('self');
  });

  it('claims "has not voted" only from a COMPLETE list', () => {
    const rows = toPositionRows([vote({ drepId: DREP_B })]);
    const identity = { drepId: DREP_A, kind: 'delegated' as const };
    expect(resolveYourPosition(rows, identity, true)).toEqual({ kind: 'notVoted', who: 'delegated' });
    // Truncated: absence from the loaded prefix proves nothing about the vote.
    expect(resolveYourPosition(rows, identity, false)).toEqual({ kind: 'unknown', who: 'delegated' });
  });

  it('treats a keyword delegation as a standing position, not a missing vote', () => {
    // Always-abstain casts no vote row at all, so "has not voted" would be a
    // misleading way to describe a choice the user deliberately made.
    for (const keyword of ['drep_always_abstain', 'drep_always_no_confidence']) {
      const result = resolveYourPosition(toPositionRows([vote()]), { drepId: keyword, kind: 'delegated' }, true);
      expect(result).toEqual({ kind: 'keyword', who: 'delegated' });
    }
  });
});
