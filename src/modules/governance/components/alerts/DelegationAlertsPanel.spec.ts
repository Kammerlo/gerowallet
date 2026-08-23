// Render coverage for DelegationAlertsPanel.vue.
//
// `npm run typecheck` is plain `tsc --noEmit`, which does not look inside a
// `.vue` SFC, so without this the panel's template and its bindings are wholly
// unverified. What matters here is the seam between the store's facts and what
// the user actually reads: the three card types with their severity treatments,
// the settings card, and the stake rendered through the SHARED lovelace
// formatter rather than a fork.
//
// The store is stubbed rather than driven: its rules have their own 51-test
// spec (governanceAlertsStore.spec.ts), and importing it for real would drag in
// walletStore, Dexie and blockchain-api for a test about markup.
import { describe, it, expect, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';

const { push, state } = vi.hoisted(() => {
  // 15 of 20 epochs into the window, 5 left; recent rationale rate well below
  // the long-run one. The same numbers the store's spec asserts against.
  const facts = {
    epochsSinceVote: 15,
    epochsLeft: 5,
    activityWindow: 20,
    rationaleRecent: 20,
    rationaleLongRun: 76,
    recentWindow: 10,
    stakeLovelace: '23718000000',
  };
  return {
    push: vi.fn(() => Promise.resolve()),
    state: {
      alerts: [
        {
          id: 'inactivity:drep1abc',
          kind: 'inactivity',
          severity: 'warning',
          epoch: 653,
          drepId: 'drep1abc',
          dismissedUntilEpoch: null,
          facts,
        },
        {
          id: 'rationaleDrop:drep1abc',
          kind: 'rationaleDrop',
          severity: 'info',
          epoch: 652,
          drepId: 'drep1abc',
          dismissedUntilEpoch: null,
          facts,
        },
      ],
      settings: { inactivityWarnAt: 15, rationaleDropEnabled: true, pushEnabled: false },
      snoozes: {},
      drepId: 'drep1abc',
      evaluatedAt: 1_700_000_000_000,
      loading: false,
      error: null,
    },
  };
});

vi.mock('vue-router/composables', () => ({
  useRouter: () => ({ push, resolve: () => ({ route: { matched: [] } }) }),
}));

vi.mock('@/stores/networkStore', () => ({
  networkStore: { tip: { epoch: 653 }, epochParams: null },
  isBitcoinTip: () => false,
  default: { getCurrentEpoch: () => 653 },
}));

vi.mock('@/stores/governanceAlertsStore', () => ({
  DEFAULT_SNOOZE_WARN_AT: 18,
  default: {
    state,
    activeAlerts: () => state.alerts,
    snooze: vi.fn(),
    dismiss: vi.fn(),
    setSettings: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
  },
}));

import Panel from '@/modules/governance/components/alerts/DelegationAlertsPanel.vue';

/**
 * Only the Vuetify layer is stubbed. Components the panel imports through
 * `<script setup>` (GButton, EmptyState, AsOf) are NOT stubbable by name under
 * Vue 2.7 — VTU never matches them — so they render for real, which is the
 * stricter test anyway. `v-btn` therefore has to be a real button for GButton's
 * `v-on="$listeners"` to reach a click.
 *
 * `$t` echoes the key plus its interpolation params, so an assertion can pin
 * both the translation contract and the VALUES bound into it without depending
 * on the English copy.
 */
function render(): Wrapper<Vue> {
  return mount(Panel, {
    mocks: {
      $t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    },
    stubs: {
      'v-icon': { template: '<i><slot /></i>' },
      'v-btn': { template: '<button v-on="$listeners"><slot /></button>' },
      'v-skeleton-loader': true,
      'v-chip-group': { template: '<div><slot /></div>' },
      'v-chip': { template: '<span><slot /></span>' },
      'v-switch': true,
    },
  });
}

describe('DelegationAlertsPanel', () => {
  it('renders one card per active alert', () => {
    expect(render().findAll('.delegation-alerts__card')).toHaveLength(2);
  });

  it('gives the inactivity card the amber treatment and the clock glyph', () => {
    const card = render().findAll('.delegation-alerts__card').at(0);
    expect(card.classes()).toContain('delegation-alerts__card--warning');
    expect(card.find('.delegation-alerts__glyph--warning').exists()).toBe(true);
    expect(card.html()).toContain('mdi-clock-alert-outline');
    expect(card.html()).toContain('governance.alerts.inactivityTitle');
  });

  it('gives the rationale card the neutral info treatment and no severity tint', () => {
    const card = render().findAll('.delegation-alerts__card').at(1);
    expect(card.classes()).not.toContain('delegation-alerts__card--warning');
    expect(card.classes()).not.toContain('delegation-alerts__card--critical');
    expect(card.html()).toContain('mdi-message-text-outline');
    expect(card.html()).toContain('governance.alerts.rationaleTitle');
  });

  it('draws the inactivity progress track at 15 of 20 epochs', () => {
    const fill = render().find('.delegation-alerts__fill');
    expect(fill.attributes('style')).toContain('width: 75%');
    expect(render().html()).toContain('governance.alerts.inactivityProgress');
  });

  it('renders the stake through the shared lovelace formatter, not a fork', () => {
    // 23718000000 lovelace, via filters.toCurrency — grouped, symbol-prefixed,
    // and with no trailing zeros. A hand-rolled formatter would not match.
    expect(render().html()).toContain('₳23,718');
  });

  it('offers the snooze on the inactivity card only', () => {
    const cards = render().findAll('.delegation-alerts__card');
    expect(cards.at(0).html()).toContain('governance.alerts.remindMeAt');
    expect(cards.at(1).html()).not.toContain('governance.alerts.remindMeAt');
  });

  it('renders at most one gradient CTA across the whole surface', () => {
    expect(render().findAll('.g-btn--primary')).toHaveLength(1);
  });

  it('routes the replacement CTA to the directory, never to a named DRep', async () => {
    const wrapper = render();
    await wrapper.findAll('.delegation-alerts__card').at(0).find('button').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'governanceDReps' });
  });

  it('renders the alert-settings card and the honesty footer', () => {
    const html = render().html();
    expect(html).toContain('governance.alerts.settingsTitle');
    expect(html).toContain('governance.alerts.settingsInactivityValue');
    expect(html).toContain('governance.alerts.settingsRationale');
    expect(html).toContain('governance.alerts.settingsRetirement');
    expect(html).toContain('governance.alerts.alwaysOn');
    // Push is stated as off, because there is no push channel to switch on.
    expect(html).toContain('common.off');
    expect(html).toContain('governance.alerts.footer');
  });

  it('shows the positive empty state when nothing is wrong', () => {
    const alerts = state.alerts;
    state.alerts = [];
    try {
      const wrapper = render();
      expect(wrapper.findAll('.delegation-alerts__card')).toHaveLength(0);
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.html()).toContain('governance.alerts.allHealthy');
    } finally {
      state.alerts = alerts;
    }
  });
});
