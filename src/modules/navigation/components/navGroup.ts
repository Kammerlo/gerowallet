/**
 * The drawer's one expandable group: Governance.
 *
 * This lives outside the SFC because the invariant it carries is the whole
 * reason the group was rewritten: STANDING INSIDE THE GROUP MUST SHOW EVERY
 * CHILD. The previous model was a single boolean that the chevron and a route
 * watcher both wrote, and the watcher only ever set it true — on a PATH CHANGE.
 * Collapse the group while already on `/governance/dreps` and nothing could
 * re-open it: navigation inside the group never changed the prefix, so the
 * watcher never fired, and the siblings (Actions above all) simply were not in
 * the DOM. Deriving the state makes that unreachable rather than merely fixed.
 */

/** Every route inside the group shares this prefix. */
export const GOVERNANCE_PREFIX = '/governance';

/** A row in the submenu. `flag` narrows the parent's gate, never widens it. */
export interface GovernanceChild {
  /** i18n key for the label. */
  titleKey: string;
  link: string;
  /**
   * 'voting' rides the governance VOTING sub-flag on top of the master gate,
   * mirroring the router's extra `governanceRegister` maintenance case.
   */
  flag?: 'voting';
}

/**
 * The submenu, in order. Every link here must be a real route: the DRep
 * directory was already lost once to a merge, and a child pointing at nothing
 * looks identical to a child that is simply unreachable.
 */
export const GOVERNANCE_CHILDREN: readonly GovernanceChild[] = Object.freeze([
  { titleKey: 'navigation.governanceMe', link: '/governance/me' },
  { titleKey: 'governance.dReps', link: '/governance/dreps' },
  { titleKey: 'common.actions', link: '/governance/actions' },
  { titleKey: 'navigation.becomeDRep', link: '/governance/register', flag: 'voting' },
]);

/** True on any governance route: the hub, a DRep profile, an action detail. */
export function isInGovernanceGroup(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(GOVERNANCE_PREFIX);
}

/**
 * Whether the submenu renders.
 *
 * The route wins. `userExpanded` is what the chevron last chose and only
 * matters when the user is somewhere else entirely — inside the group there is
 * nothing to toggle, which is why the drawer hides the chevron there rather
 * than offering a control that does nothing.
 */
export function isGovernanceGroupOpen(path: string | null | undefined, userExpanded: boolean): boolean {
  return isInGovernanceGroup(path) || userExpanded;
}
