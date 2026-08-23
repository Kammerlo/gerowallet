<template>
  <div class="delegation-alerts">
    <section class="delegation-alerts__feed glass-panel">
      <header class="delegation-alerts__head">
        <span class="t-label delegation-alerts__eyebrow">{{ $t('governance.alerts.title') }}</span>
        <AsOf :timestamp="state.evaluatedAt" />
      </header>

      <ErrorState v-if="state.error" :message="state.error" retryable @retry="refresh()" />

      <div v-else-if="state.loading && !alerts.length" class="delegation-alerts__loading">
        <v-skeleton-loader v-for="n in 2" :key="n" type="list-item-two-line" />
      </div>

      <EmptyState
        v-else-if="!alerts.length"
        icon="mdi-shield-check-outline"
        :message="$t('governance.alerts.allHealthy')"
      />

      <ul v-else class="delegation-alerts__list">
        <li
          v-for="alert in alerts"
          :key="alert.id"
          class="delegation-alerts__card"
          :class="`delegation-alerts__card--${alert.severity}`"
        >
          <span class="delegation-alerts__glyph" :class="`delegation-alerts__glyph--${alert.severity}`">
            <v-icon :size="18">{{ glyph(alert) }}</v-icon>
          </span>

          <div class="delegation-alerts__body">
            <div class="delegation-alerts__row">
              <span class="t-body-2 delegation-alerts__title">{{ title(alert) }}</span>

              <span
                v-if="alert.kind === 'inactivity' && alert.facts.epochsLeft"
                class="t-caption delegation-alerts__pill delegation-alerts__pill--warning"
              >
                {{ $t('governance.epochsRemaining', { n: alert.facts.epochsLeft }) }}
              </span>
              <span
                v-else-if="alert.severity === 'critical'"
                class="t-caption delegation-alerts__pill delegation-alerts__pill--critical"
              >
                {{ $t('governance.alerts.actionNeeded') }}
              </span>

              <span v-if="alert.epoch !== null" class="t-caption delegation-alerts__epoch g-num">
                {{ $t('governance.alerts.atEpoch', { epoch: alert.epoch }) }}
              </span>
            </div>

            <p class="t-body-2 delegation-alerts__text">{{ body(alert) }}</p>

            <div v-if="alert.kind === 'inactivity' && progress(alert) !== null" class="delegation-alerts__progress">
              <span class="delegation-alerts__track" role="img" :aria-label="progressLabel(alert)">
                <span class="delegation-alerts__fill" :style="{ width: `${progress(alert)}%` }"></span>
              </span>
              <span class="t-caption delegation-alerts__progress-label g-num">{{ progressLabel(alert) }}</span>
            </div>

            <div class="delegation-alerts__actions">
              <!-- The replacement CTA always routes to the DIRECTORY. The wallet
                   states facts about the DRep the user chose; picking the next
                   one is the user's call, never a name Gero puts forward. -->
              <GButton
                v-if="alert.kind !== 'rationaleDrop'"
                :tier="alert.id === primaryAlertId ? 'primary' : 'secondary'"
                compact
                @click="goToDirectory()"
              >
                {{ alert.kind === 'retired' ? $t('governance.alerts.chooseNewDRep') : $t('governance.alerts.findReplacement') }}
              </GButton>

              <GButton
                v-if="alert.kind === 'inactivity'"
                tier="secondary"
                compact
                @click="snooze(alert)"
              >
                {{ $t('governance.alerts.remindMeAt', { epoch: snoozeTarget }) }}
              </GButton>

              <GButton
                v-if="alert.kind === 'rationaleDrop'"
                tier="secondary"
                compact
                @click="goToProfile(alert.drepId)"
              >
                {{ $t('governance.alerts.reviewRecord') }}
              </GButton>

              <GButton
                v-if="alert.kind === 'rationaleDrop'"
                tier="tertiary"
                compact
                @click="dismiss(alert)"
              >
                {{ $t('governance.alerts.dismiss') }}
              </GButton>
            </div>
          </div>
        </li>
      </ul>

      <p class="t-caption delegation-alerts__footer">{{ $t('governance.alerts.footer') }}</p>
    </section>

    <section class="delegation-alerts__settings glass-panel">
      <span class="t-label delegation-alerts__eyebrow">{{ $t('governance.alerts.settingsTitle') }}</span>

      <div class="delegation-alerts__setting">
        <span class="t-body-2 delegation-alerts__setting-label">{{ $t('governance.alerts.settingsInactivity') }}</span>
        <span class="t-caption delegation-alerts__setting-value">
          {{ $t('governance.alerts.settingsInactivityValue', { at: settings.inactivityWarnAt, window: activityWindow }) }}
        </span>
      </div>
      <v-chip-group :value="settings.inactivityWarnAt" mandatory @change="onWarnAtChange">
        <v-chip v-for="at in WARN_AT_CHOICES" :key="at" :value="at" small outlined class="g-num">
          {{ at }}
        </v-chip>
      </v-chip-group>

      <div class="delegation-alerts__setting">
        <span class="t-body-2 delegation-alerts__setting-label">{{ $t('governance.alerts.settingsRationale') }}</span>
        <v-switch
          :input-value="settings.rationaleDropEnabled"
          dense
          hide-details
          class="delegation-alerts__switch"
          :aria-label="$t('governance.alerts.settingsRationale')"
          @change="onRationaleChange"
        />
      </div>

      <div class="delegation-alerts__setting">
        <span class="t-body-2 delegation-alerts__setting-label">{{ $t('governance.alerts.settingsRetirement') }}</span>
        <span class="t-caption delegation-alerts__setting-value">{{ $t('governance.alerts.alwaysOn') }}</span>
      </div>

      <div class="delegation-alerts__setting">
        <span class="t-body-2 delegation-alerts__setting-label">{{ $t('governance.alerts.settingsPush') }}</span>
        <span class="t-caption delegation-alerts__setting-muted">{{ $t('common.off') }}</span>
      </div>
      <p class="t-caption delegation-alerts__footer">{{ $t('governance.alerts.pushUnavailable') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router/composables';

import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import governanceAlertsStore, {
  DEFAULT_SNOOZE_WARN_AT,
  type GovernanceAlert,
} from '@/stores/governanceAlertsStore';
import NetworkStore from '@/stores/networkStore';

/**
 * The delegation watchdog's surface.
 *
 * Self-contained by design: it fetches nothing, computes nothing about a DRep,
 * and holds no state of its own. Its sources are `governanceAlertsStore` (which
 * owns evaluation, the settings and the snoozes) and the router. Everything it
 * renders is a public on-chain fact the store already asserted, which is what
 * the footer line promises the user.
 *
 * The replacement CTAs route to the DRep DIRECTORY, never to a named DRep — the
 * wallet does not put candidates forward.
 */

const router = useRouter();
const { t } = useTranslation();

const state = governanceAlertsStore.state;
const settings = computed(() => state.settings);

/** How far into the window the warning may be moved. Endpoints, not advice. */
const WARN_AT_CHOICES = [10, 12, 15, 18];

const alerts = computed(() => governanceAlertsStore.activeAlerts());

/**
 * At most one gradient CTA on the surface. Retirement and inactivity are
 * mutually exclusive by construction (the store suppresses the countdown once a
 * DRep has deregistered), so this resolves to a single alert or none.
 */
const primaryAlertId = computed(
  () => alerts.value.find((alert) => alert.kind !== 'rationaleDrop')?.id ?? null,
);

/** The activity window the current alerts were measured against. */
const activityWindow = computed(() => alerts.value[0]?.facts.activityWindow ?? 20);

/** The "remind me at N" target, kept in step with a moved warning threshold. */
const snoozeTarget = computed(() =>
  Math.min(activityWindow.value, Math.max(settings.value.inactivityWarnAt + 3, DEFAULT_SNOOZE_WARN_AT)),
);

function glyph(alert: GovernanceAlert): string {
  if (alert.kind === 'retired') return 'mdi-account-arrow-left-outline';
  if (alert.kind === 'rationaleDrop') return 'mdi-message-text-outline';
  return 'mdi-clock-alert-outline';
}

function title(alert: GovernanceAlert): string {
  if (alert.kind === 'retired') return t('governance.alerts.retiredTitle');
  if (alert.kind === 'rationaleDrop') return t('governance.alerts.rationaleTitle');
  return alert.severity === 'critical'
    ? t('governance.alerts.inactivityExpiredTitle')
    : t('governance.alerts.inactivityTitle');
}

/** The stake at risk, through the shared lovelace formatter — never re-derived here. */
function stake(alert: GovernanceAlert): string {
  return filters.toCurrency(alert.facts.stakeLovelace ?? '0');
}

function body(alert: GovernanceAlert): string {
  const { facts } = alert;
  if (alert.kind === 'retired') {
    return t('governance.alerts.retiredBody', { amount: stake(alert) });
  }
  if (alert.kind === 'rationaleDrop') {
    return t('governance.alerts.rationaleBody', {
      window: facts.recentWindow,
      recent: facts.rationaleRecent ?? 0,
      longRun: facts.rationaleLongRun ?? 0,
    });
  }
  return alert.severity === 'critical'
    ? t('governance.alerts.inactivityExpiredBody', { window: facts.activityWindow, amount: stake(alert) })
    : t('governance.alerts.inactivityBody', {
        since: facts.epochsSinceVote ?? 0,
        window: facts.activityWindow,
        amount: stake(alert),
      });
}

/** How far through the activity window the DRep is, as a percentage of the track. */
function progress(alert: GovernanceAlert): number | null {
  const { epochsSinceVote, activityWindow: window } = alert.facts;
  if (epochsSinceVote === null || window <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((epochsSinceVote / window) * 100)));
}

function progressLabel(alert: GovernanceAlert): string {
  return t('governance.alerts.inactivityProgress', {
    since: alert.facts.epochsSinceVote ?? 0,
    window: alert.facts.activityWindow,
  });
}

function goToDirectory(): void {
  router.push({ name: 'governanceDReps' }).catch(() => undefined);
}

/**
 * The DRep's own page. That route arrives with the DRep surfaces; until it
 * does, the directory's existing `?drep=` deep link reaches the same record, so
 * the button is never a dead end.
 */
function goToProfile(drepId: string | null): void {
  if (!drepId) return;
  const path = `/governance/dreps/${drepId}`;
  const resolved = router.resolve(path);
  if (resolved.route.matched.length > 0) {
    router.push(path).catch(() => undefined);
    return;
  }
  router.push({ name: 'governanceDReps', query: { drep: drepId } }).catch(() => undefined);
}

function snooze(alert: GovernanceAlert): void {
  governanceAlertsStore.snooze(alert.id, snoozeTarget.value);
}

function dismiss(alert: GovernanceAlert): void {
  governanceAlertsStore.dismiss(alert.id);
}

function refresh(): void {
  void governanceAlertsStore.refresh();
}

function onWarnAtChange(value: number | undefined): void {
  if (typeof value !== 'number') return;
  governanceAlertsStore.setSettings({ inactivityWarnAt: value });
  refresh();
}

function onRationaleChange(value: boolean | null): void {
  governanceAlertsStore.setSettings({ rationaleDropEnabled: !!value });
  refresh();
}

// The store re-evaluates on login and on every epoch rollover, so the alerts are
// normally already in place when this mounts. This covers the one gap that
// leaves: a wallet whose tip has not moved since the store last looked, opened
// from a cold start.
onMounted(() => {
  if (state.evaluatedAt === null && NetworkStore.getCurrentEpoch() !== null) refresh();
});
</script>

<style scoped>
.delegation-alerts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.delegation-alerts__feed,
.delegation-alerts__settings {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
}

.delegation-alerts__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.delegation-alerts__eyebrow {
  color: var(--g-text-3);
}

.delegation-alerts__loading,
.delegation-alerts__list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Elevation is surface plus a hairline; the severity only tints the hairline. */
.delegation-alerts__card {
  display: flex;
  gap: var(--g-s-3);
  align-items: flex-start;
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.delegation-alerts__card--warning {
  border-color: var(--g-warning-line);
}
.delegation-alerts__card--critical {
  border-color: var(--g-error-line);
}

.delegation-alerts__glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--g-btn-h-compact);
  height: var(--g-btn-h-compact);
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  color: var(--g-info);
}
.delegation-alerts__glyph--warning {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}
.delegation-alerts__glyph--critical {
  background: var(--g-error-fill);
  color: var(--g-error);
}
.delegation-alerts__glyph .v-icon {
  color: inherit;
}

.delegation-alerts__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  flex: 1;
  min-width: 0;
}
.delegation-alerts__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.delegation-alerts__title {
  color: var(--g-text-1);
}
.delegation-alerts__epoch {
  margin-left: auto;
  color: var(--g-text-3);
}
.delegation-alerts__text {
  margin: 0;
  color: var(--g-text-2);
}

.delegation-alerts__pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
}
.delegation-alerts__pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.delegation-alerts__pill--critical {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

.delegation-alerts__progress {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
.delegation-alerts__track {
  flex: 1;
  overflow: hidden;
  height: var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
}
.delegation-alerts__fill {
  display: block;
  height: 100%;
  background: var(--g-warning);
  transition: width var(--g-dur-base) var(--g-ease);
}
.delegation-alerts__progress-label {
  color: var(--g-text-3);
}

.delegation-alerts__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.delegation-alerts__footer {
  margin: 0;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
  color: var(--g-text-3);
}

.delegation-alerts__setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  min-height: var(--g-row-h-panel);
}
.delegation-alerts__setting-label {
  color: var(--g-text-2);
}
.delegation-alerts__setting-value {
  color: var(--g-accent);
}
.delegation-alerts__setting-muted {
  color: var(--g-text-3);
}
.delegation-alerts__switch {
  margin: 0;
  padding: 0;
  flex: none;
}
</style>
