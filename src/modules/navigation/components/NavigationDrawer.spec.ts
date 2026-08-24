// The governance submenu as rendered.
//
// `navGroup.spec.ts` pins the open/closed RULE; this file pins that the drawer
// obeys it in the DOM, because the bug the rule replaced was not a wrong value,
// it was three links that were never rendered. Standing on the DRep directory,
// My governance / DReps / Actions must all be present and all be real links,
// whatever the user last did with the chevron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const h = vi.hoisted(() => ({
  route: { path: '/governance/dreps', query: {} as Record<string, unknown> },
  push: vi.fn(),
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: vi.fn(), sendToBackground: vi.fn() },
}));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));
vi.mock('@/plugins/changeLog', () => ({ default: { setEnabled: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
// Relies on the build's auto-import plugin for `ref`, which the test runner does
// not load. Nothing here is about feature badges.
vi.mock('@/shared/composables/useFeatureNotifications', () => ({
  hasNewFeaturesInPath: () => false,
  isFeatureNew: () => false,
  markFeatureAsSeen: vi.fn(),
}));

const $t = (key: string): string => key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import NavigationDrawer from './NavigationDrawer.vue';
import { walletStore } from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { GOVERNANCE_CHILDREN } from './navGroup';

function mountDrawer(path: string): Wrapper<Vue> {
  h.route.path = path;
  return mount(NavigationDrawer, {
    propsData: { value: true },
    mocks: {
      $t,
      $route: h.route,
      $router: { push: h.push, currentRoute: h.route },
      $vuetify: { breakpoint: { mobile: false }, theme: { dark: true } },
    },
    stubs: {
      // The drawer itself renders its content through named slots.
      'v-navigation-drawer': {
        template: '<div><slot name="prepend" /><slot /><slot name="append" /></div>',
      },
      'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
      'v-img': true,
      'v-icon': true,
      'v-badge': { template: '<span><slot /></span>' },
      'v-tooltip': { template: '<span><slot name="activator" :on="{}" :attrs="{}" /></span>' },
      'v-chip': true,
      'v-progress-circular': true,
      'v-divider': true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/**
 * Every submenu row's target, in render order. Vuetify is not installed here, so
 * `v-list-item` stays an unresolved element and its `to` is a plain attribute —
 * which is exactly the binding under test.
 */
function childLinks(w: Wrapper<Vue>): string[] {
  return w.findAll('.nav-group__child').wrappers.map(row => row.attributes('to') ?? '');
}

/** The labels a person actually sees under Governance, in render order. */
function childTitles(w: Wrapper<Vue>): string[] {
  return w.findAll('.nav-group__child-title').wrappers.map(node => node.text());
}

let wrapper: Wrapper<Vue> | null = null;

/** Every concrete governance page a user can be standing on. */
const GOVERNANCE_PAGES = [
  '/governance/me',
  '/governance/dreps',
  '/governance/dreps/drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2',
  '/governance/actions',
  '/governance/actions/9f8e7d6c/0',
  '/governance/register',
];

// Injected by vite's `define` at build time; the runner has no such define.
vi.stubGlobal('APP_VERSION', '0.0.0-test');

beforeEach(() => {
  vi.clearAllMocks();
  // The drawer's footer card reads name/icon off the logged wallet.
  walletStore.loggedWallet = {
    chain: 'Cardano',
    network: 'Mainnet',
    baseAddress: null,
    name: 'Test wallet',
    icon: 'gero',
  } as never;
  vi.spyOn(featureFlagsStore, 'isGovernanceEnabled').mockReturnValue(true);
  vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(true);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('NavigationDrawer: the governance submenu', () => {
  it('renders every child on every governance page', () => {
    for (const path of GOVERNANCE_PAGES) {
      wrapper = mountDrawer(path);
      expect(childLinks(wrapper), path).toEqual(GOVERNANCE_CHILDREN.map(child => child.link));
      wrapper.destroy();
      wrapper = null;
    }
  });

  it('reaches Actions from the DReps screen, which is the bug this replaced', () => {
    wrapper = mountDrawer('/governance/dreps');
    expect(childLinks(wrapper)).toContain('/governance/actions');
    expect(childTitles(wrapper)).toEqual([
      'navigation.governanceMe',
      'governance.dReps',
      'common.actions',
      'navigation.becomeDRep',
    ]);
  });

  it('keeps the children rendered after the chevron is used inside the group', async () => {
    wrapper = mountDrawer('/governance/dreps');
    // The chevron is not even offered inside the group: there is nothing it
    // could do, and offering it is how people used to strand themselves.
    expect(wrapper.find('.nav-group__actions button').exists()).toBe(false);

    // Force the user-toggle false anyway and re-render: the route still wins.
    (wrapper.vm as unknown as { governanceUserExpanded: boolean }).governanceUserExpanded = false;
    await Vue.nextTick();
    expect(childLinks(wrapper)).toContain('/governance/actions');
  });

  it('marks the active child with the drawer\'s own active class, not a bespoke rail', () => {
    wrapper = mountDrawer('/governance/dreps');
    // The bespoke `--active` modifier (and the accent side border it carried) is
    // gone: children take the same treatment as every other active drawer row.
    expect(wrapper.html()).not.toContain('nav-group__child--active');
    const rows = wrapper.findAll('.nav-group__child').wrappers;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.attributes('active-class')).toBe('activePageDark');
    }
  });

  it('hides the submenu elsewhere until the chevron opens it', async () => {
    wrapper = mountDrawer('/staking');
    expect(childLinks(wrapper)).toEqual([]);

    const chevron = wrapper.find('.nav-group__actions button');
    expect(chevron.exists()).toBe(true);
    await chevron.trigger('click');
    await Vue.nextTick();
    expect(childLinks(wrapper)).toEqual(GOVERNANCE_CHILDREN.map(child => child.link));
  });

  it('drops registration when the voting sub-flag is off', () => {
    vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(false);
    wrapper = mountDrawer('/governance/dreps');
    const links = childLinks(wrapper);
    expect(links).not.toContain('/governance/register');
    expect(links).toContain('/governance/actions');
  });
});
