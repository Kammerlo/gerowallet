// "I can't get to Actions from the DReps screen."
//
// The submenu was hidden behind a single boolean that only a PATH-CHANGE
// watcher ever set true. Collapse the group while standing on /governance/dreps
// and no navigation inside the group could bring it back, because the prefix
// never changed — so Actions was not gated, it was simply not rendered.
//
// These tests pin the replacement: while any governance route is active, every
// child renders, whatever the user last did with the chevron. They also check
// the submenu against the router's own governance paths, because a child
// pointing at a route that no longer exists looks exactly like this bug (the
// DRep directory route was already lost once to a merge).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  GOVERNANCE_CHILDREN,
  GOVERNANCE_PREFIX,
  isGovernanceGroupOpen,
  isInGovernanceGroup,
} from './navGroup';

/**
 * Every governance path the router declares, read as text. Importing router.ts
 * would drag in ContentLayout and the whole dashboard; the paths are string
 * literals, and reading them is enough to catch a child that points nowhere.
 */
function routerGovernancePaths(): string[] {
  const source = readFileSync(resolve(__dirname, '../router.ts'), 'utf8');
  return [...source.matchAll(/path:\s*'(\/governance[^']*)'/g)].map(match => match[1]);
}

/** Concrete paths a user can actually be standing on, params filled in. */
const LIVE_PATHS = [
  '/governance',
  '/governance/me',
  '/governance/dreps',
  '/governance/dreps/drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2',
  '/governance/actions',
  '/governance/actions/9f8e7d6c/0',
  '/governance/register',
];

describe('governance nav group: reachability', () => {
  it('recognises every live governance path as inside the group', () => {
    for (const path of LIVE_PATHS) {
      expect(isInGovernanceGroup(path), path).toBe(true);
    }
  });

  it('renders every child from every governance page, even after the user collapsed it', () => {
    for (const path of LIVE_PATHS) {
      // userExpanded false is the collapsed case that used to strand people.
      expect(isGovernanceGroupOpen(path, false), path).toBe(true);
    }
  });

  it('carries My governance, DReps and Actions in the submenu', () => {
    const links = GOVERNANCE_CHILDREN.map(child => child.link);
    expect(links).toContain('/governance/me');
    expect(links).toContain('/governance/dreps');
    expect(links).toContain('/governance/actions');
  });

  it('keeps the group open when a child is clicked, so the siblings stay reachable', () => {
    // Landing on any child must itself be a governance path: that is what makes
    // the three children reachable from each other rather than one-way doors.
    for (const child of GOVERNANCE_CHILDREN) {
      expect(isGovernanceGroupOpen(child.link, false), child.link).toBe(true);
    }
  });

  it('points every child at a route the router actually declares', () => {
    const declared = routerGovernancePaths();
    expect(declared.length).toBeGreaterThan(0);
    for (const child of GOVERNANCE_CHILDREN) {
      expect(declared, child.link).toContain(child.link);
    }
  });

  it('gates only registration behind the voting sub-flag', () => {
    const flagged = GOVERNANCE_CHILDREN.filter(child => child.flag);
    expect(flagged.map(child => child.link)).toEqual(['/governance/register']);
    expect(flagged[0].flag).toBe('voting');
  });
});

describe('governance nav group: outside the group', () => {
  it('stays closed elsewhere unless the user opened it', () => {
    for (const path of ['/', '/staking', '/transactions', '/dao']) {
      expect(isGovernanceGroupOpen(path, false), path).toBe(false);
      expect(isGovernanceGroupOpen(path, true), path).toBe(true);
    }
  });

  it('does not treat a lookalike path as governance', () => {
    expect(isInGovernanceGroup('/gov')).toBe(false);
    expect(isInGovernanceGroup('/dao/governance')).toBe(false);
    expect(isInGovernanceGroup(null)).toBe(false);
    expect(isInGovernanceGroup(undefined)).toBe(false);
  });

  it('exposes the prefix the drawer and the router agree on', () => {
    expect(GOVERNANCE_PREFIX).toBe('/governance');
    for (const path of routerGovernancePaths()) {
      expect(path.startsWith(GOVERNANCE_PREFIX), path).toBe(true);
    }
  });
});
