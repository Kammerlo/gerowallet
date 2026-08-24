// The directory's ordering, and above all its NEUTRALITY.
//
// Gero does not rank DReps. The page arrives ordered by participation, and it
// becomes ordered by voting power only because a person clicked that column.
// These tests exist so that stays true after someone "improves" the default,
// and so the comparator keeps its two quieter promises: BigInt-exact power, and
// unknown figures that never masquerade as bad ones.
import { describe, it, expect } from 'vitest';
import {
  ariaSortFor,
  DEFAULT_SORT,
  nextSort,
  SORTABLE_KEYS,
  sortDirectory,
  type SortableRow,
  type SortState,
} from './drepDirectory.sort';

interface Row extends SortableRow {
  name: string;
}

/**
 * Absent means "use the filler"; an explicit null means "this DRep's figure is
 * genuinely unknown". `??` cannot tell those apart, and conflating them is how a
 * pending-sorts-last test silently stops testing anything.
 */
function pick(value: number | null | undefined, filler: number): number | null {
  return value === undefined ? filler : value;
}

function row(
  name: string,
  over: {
    participation?: number | null;
    rationale?: number | null;
    delegators?: number | null;
    lastVote?: number | null;
    power?: bigint;
  } = {},
): Row {
  return {
    name,
    key: name,
    stats: {
      participation: { pct: pick(over.participation, 50) },
      rationaleRate: { pct: pick(over.rationale, 50) },
      delegatorCount: pick(over.delegators, 100),
      lastVoteBlockTime: pick(over.lastVote, 1_700_000_000),
      votingPower: over.power ?? 1_000_000n,
    },
  };
}

const order = (rows: Row[]): string[] => rows.map(r => r.name);

describe('DRep directory: the default order', () => {
  it('is participation, descending', () => {
    expect(DEFAULT_SORT.key).toBe('participation');
    expect(DEFAULT_SORT.dir).toBe('desc');
  });

  it('is never voting power, whatever the powers are', () => {
    // The whale is dead last on participation. If power ever leaks into the
    // default it lands first, and this fails.
    const rows = [
      row('whale', { participation: 3, power: 90_000_000_000_000n }),
      row('worker', { participation: 97, power: 12n }),
    ];
    expect(order(sortDirectory(rows, DEFAULT_SORT))).toEqual(['worker', 'whale']);
  });

  it('offers power as one sortable column among five', () => {
    expect([...SORTABLE_KEYS].sort()).toEqual(
      ['delegators', 'lastVote', 'participation', 'power', 'rationale'],
    );
  });
});

describe('DRep directory: header toggling', () => {
  it('flips direction when the active column is clicked again', () => {
    const first = nextSort(DEFAULT_SORT, 'participation');
    expect(first).toEqual({ key: 'participation', dir: 'asc' });
    expect(nextSort(first, 'participation')).toEqual({ key: 'participation', dir: 'desc' });
  });

  it('takes over at descending when another column is clicked', () => {
    const ascending: SortState = { key: 'participation', dir: 'asc' };
    expect(nextSort(ascending, 'power')).toEqual({ key: 'power', dir: 'desc' });
    expect(nextSort({ key: 'power', dir: 'asc' }, 'delegators')).toEqual({
      key: 'delegators',
      dir: 'desc',
    });
  });

  it('never produces an unsorted state', () => {
    // Twelve clicks around the header row: every result is still a real order.
    let state: SortState = { ...DEFAULT_SORT };
    for (const key of [...SORTABLE_KEYS, ...SORTABLE_KEYS, ...SORTABLE_KEYS.slice(0, 2)]) {
      state = nextSort(state, key);
      expect(SORTABLE_KEYS).toContain(state.key);
      expect(['asc', 'desc']).toContain(state.dir);
    }
  });

  it('announces a direction on the active column only', () => {
    const state: SortState = { key: 'power', dir: 'asc' };
    expect(ariaSortFor(state, 'power')).toBe('ascending');
    expect(ariaSortFor({ key: 'power', dir: 'desc' }, 'power')).toBe('descending');
    expect(ariaSortFor(state, 'participation')).toBe('none');
  });
});

describe('DRep directory: the comparator', () => {
  it('orders voting power with BigInt precision', () => {
    // These two differ by 1 lovelace and are both far above 2^53. Number()
    // collapses them to the same double, so a lossy comparator returns the
    // input order and the tie-break never runs.
    const rows = [
      row('a-smaller', { power: 90_071_992_547_409_920n }),
      row('b-bigger', { power: 90_071_992_547_409_921n }),
    ];
    expect(order(sortDirectory(rows, { key: 'power', dir: 'desc' }))).toEqual([
      'b-bigger',
      'a-smaller',
    ]);
    expect(order(sortDirectory(rows, { key: 'power', dir: 'asc' }))).toEqual([
      'a-smaller',
      'b-bigger',
    ]);
  });

  it('breaks ties on the row key, never on power', () => {
    // Same participation, wildly different power. A power tie-break would put
    // the whale first; the credential order puts "aaa" first.
    const rows = [
      row('zzz', { participation: 60, power: 5_000_000_000n }),
      row('aaa', { participation: 60, power: 1n }),
    ];
    expect(order(sortDirectory(rows, DEFAULT_SORT))).toEqual(['aaa', 'zzz']);
  });

  it('sorts unknown figures last in BOTH directions', () => {
    const rows = [
      row('pending', { participation: null }),
      row('low', { participation: 10 }),
      row('high', { participation: 90 }),
    ];
    expect(order(sortDirectory(rows, { key: 'participation', dir: 'desc' }))).toEqual([
      'high',
      'low',
      'pending',
    ]);
    // Ascending puts the WORST real figure first — not the absent one.
    expect(order(sortDirectory(rows, { key: 'participation', dir: 'asc' }))).toEqual([
      'low',
      'high',
      'pending',
    ]);
  });

  it('orders every other column in both directions', () => {
    const rows = [
      row('mid', { rationale: 50, delegators: 50, lastVote: 500 }),
      row('top', { rationale: 90, delegators: 900, lastVote: 900 }),
      row('bottom', { rationale: 10, delegators: 10, lastVote: 100 }),
    ];
    for (const key of ['rationale', 'delegators', 'lastVote'] as const) {
      expect(order(sortDirectory(rows, { key, dir: 'desc' }))).toEqual(['top', 'mid', 'bottom']);
      expect(order(sortDirectory(rows, { key, dir: 'asc' }))).toEqual(['bottom', 'mid', 'top']);
    }
  });

  it('never mutates the page it was handed', () => {
    const rows = [row('b', { participation: 10 }), row('a', { participation: 90 })];
    const before = order(rows);
    sortDirectory(rows, { key: 'power', dir: 'asc' });
    expect(order(rows)).toEqual(before);
  });
});
