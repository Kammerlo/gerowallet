<template>
  <div class="action-detail">
    <div class="action-detail__nav">
      <GButton tier="tertiary" compact @click="goBack()">
        <v-icon small class="mr-1">mdi-arrow-left</v-icon>
        {{ $t('governance.back') }}
      </GButton>
      <AsOf :timestamp="state.fetchedAt" />
    </div>

    <ErrorState v-if="state.actionError" :message="state.actionError" retryable @retry="reload()" />

    <div v-else-if="state.actionLoading" class="action-detail__body">
      <v-skeleton-loader type="heading" />
      <v-skeleton-loader type="paragraph" />
      <v-skeleton-loader type="paragraph" />
    </div>

    <template v-else-if="action">
      <div class="action-detail__header">
        <div class="action-detail__badges">
          <span class="t-label action-detail__type">{{ typeLabel }}</span>
          <StatusPill :status="action.status" />
          <AnchorBadge
            :hash-valid="action.hashValid"
            :has-anchor="!!action.anchorUrl"
            :failure-reason="anchorFailureReason"
          />
        </div>
        <h1 class="t-title action-detail__title">{{ title }}</h1>
        <div class="action-detail__meta t-caption">
          <span v-if="action.deposit" class="g-num">{{ $t('governance.depositFee') }}: {{ depositAda }} ₳</span>
          <span v-if="action.submittedEpoch !== null" class="g-num">
            {{ $t('governance.submittedEpochLabel', { n: action.submittedEpoch }) }}
          </span>
          <span v-if="action.expiresEpoch !== null" class="g-num">
            {{ $t('governance.expiresEpochLabel', { n: action.expiresEpoch }) }}
          </span>
          <span v-if="epochsLeft !== null" class="g-num">
            {{ $t('governance.epochsRemaining', { n: epochsLeft }) }}<template v-if="daysLeft !== null"> ({{ $t('governance.approxDaysLeft', { n: daysLeft }) }})</template>
          </span>
        </div>
        <VoteCta :action="action" @vote="voteDialogOpen = true" />
      </div>

      <div class="action-detail__tabs" role="tablist">
        <button
          v-for="tabItem in TABS"
          :key="tabItem.id"
          type="button"
          role="tab"
          class="action-detail__tab t-body-2"
          :class="{ 'action-detail__tab--active': tab === tabItem.id }"
          :aria-selected="tab === tabItem.id ? 'true' : 'false'"
          @click="setTab(tabItem.id)"
        >
          {{ $t(tabItem.labelKey) }}
        </button>
      </div>

      <!-- Overview -->
      <div v-if="tab === 'overview'" class="action-detail__body">
        <!-- InfoAction is advisory: no threshold, can never ratify. An explicit
             panel — never a pass/fail tally. -->
        <div v-if="isInfoAction" class="action-detail__advisory glass-panel">
          <v-icon small color="var(--g-text-2)" class="mr-2">mdi-information-outline</v-icon>
          <span class="t-body-2">{{ $t('governance.infoActionAdvisory') }}</span>
        </div>
        <div v-else class="action-detail__tallies">
          <BodyTallyCard
            v-for="body in bodyResults"
            :key="body.result.body"
            :result="body.result"
            :composition="body.composition"
            :counts="body.counts"
            :threshold-note="body.thresholdNote"
          />
        </div>

        <!-- CIP-108 bodies are markdown documents, not captions: headings,
             tables and lists all appear in real proposals. Everything is
             HTML-escaped before a single markdown rule runs, so a proposal
             author cannot get markup into this page. -->
        <section v-if="action.abstractText" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.abstract') }}</h2>
          <div class="g-prose" v-html="renderedAbstract"></div>
        </section>
        <section v-if="action.motivation" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.motivation') }}</h2>
          <div class="g-prose" v-html="renderedMotivation"></div>
        </section>
        <section v-if="action.rationale" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.rationale') }}</h2>
          <div class="g-prose" v-html="renderedRationale"></div>
        </section>

        <section v-if="anchorHref || referenceLinks.length" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.references') }}</h2>
          <!-- The anchor document is not a numbered reference, so it sits
               outside the list the [n] markers point into. -->
          <a
            v-if="anchorHref"
            :href="anchorHref"
            target="_blank"
            rel="noopener noreferrer"
            class="action-detail__link t-body-2"
          >
            <v-icon x-small class="mr-1">mdi-file-document-outline</v-icon>
            {{ $t('governance.metadataDocument') }}
          </a>
          <ol v-if="referenceLinks.length" class="action-detail__references">
            <li
              v-for="link in referenceLinks"
              :id="`gov-ref-${link.number}`"
              :key="`${link.href}-${link.number}`"
              class="action-detail__reference"
            >
              <a
                :href="link.href"
                target="_blank"
                rel="noopener noreferrer"
                class="action-detail__link t-body-2"
              >
                <v-icon x-small class="mr-1">{{ link.icon }}</v-icon>
                {{ link.label }}
              </a>
            </li>
          </ol>
          <p class="t-caption action-detail__note">{{ $t('governance.externalLinksNote') }}</p>
        </section>
      </div>

      <!-- Positions (cast votes).
           Each row is that voter's STANDING position: the endpoint collapses
           re-votes, so there is exactly one row per voter and no history to
           order (verified against mainnet, 52 rows / 52 distinct voters). It
           does carry a block time, which is where the per-row date comes from
           wherever the projection passes it through. -->
      <div v-else-if="tab === 'positions'" class="action-detail__body">
        <PositionsPanel
          :votes="state.currentVotes"
          :total="state.votesTotal"
          :loading="state.votesLoading"
          :error="state.votesError"
          :truncated="state.votesTruncated"
          :identity="voterIdentity"
          :action-open="actionIsOpen"
          :chain="chain"
          :network="network"
          @retry="loadVotes()"
          @open-drep="openDRep"
        />
      </div>

      <!-- On-chain payload -->
      <div v-else-if="tab === 'onchain'" class="action-detail__body">
        <EmptyState v-if="action.govAction === null" :message="$t('common.notAvailable')" />
        <pre v-else class="action-detail__json g-mono t-caption">{{ formattedGovAction }}</pre>
      </div>

      <CastVoteDialog
        :is-open="voteDialogOpen"
        :actions="action ? [action] : []"
        @close="voteDialogOpen = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { toDisplayGovActionId } from '@/shared/utils/govActionId';
import { toLovelace } from '@/shared/utils/lovelace';
import { drepTallies, spoTallies, ccProgress } from '@/shared/utils/govTally';
import type { Composition } from '@/shared/utils/govTally';
import { evaluateThresholds } from '@/shared/utils/govThresholds';
import type { BodyResult, GovThresholdParams } from '@/shared/utils/govThresholds';
import { epochsRemaining, daysRemaining, isOpen } from '@/shared/utils/govLifecycle';
import { safeExternalHref } from '@/shared/utils/externalLink';
import { renderMarkdown } from '@/shared/utils/renderMarkdown';
import { governanceStatus } from '@/shared/composables/useGovernanceStatus';
import { useTranslation } from '@/shared/composables/useTranslation';
import StatusPill from '@/modules/governance/components/actions/StatusPill.vue';
import AnchorBadge from '@/modules/governance/components/actions/AnchorBadge.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import BodyTallyCard from '@/modules/governance/components/actions/BodyTallyCard.vue';
import VoteCta from '@/modules/governance/components/actions/VoteCta.vue';
import PositionsPanel from '@/modules/governance/components/actions/PositionsPanel.vue';
import type { PositionIdentity } from '@/modules/governance/components/actions/positions';
import { referenceHrefResolver, toReferenceLinks } from '@/modules/governance/components/actions/references';
import CastVoteDialog from '@/modules/governance/dialogs/CastVoteDialog.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';

const TABS = [
  { id: 'overview', labelKey: 'governance.overview' },
  { id: 'positions', labelKey: 'governance.votes' },
  { id: 'onchain', labelKey: 'governance.onchainData' },
] as const;

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

const state = governanceActionsStore.state;

const network = computed(() => String(walletStore.loggedWallet?.network ?? ''));
const chain = computed(() => String(walletStore.loggedWallet?.chain ?? ''));
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

const govActionId = computed(() =>
  toDisplayGovActionId({
    txHash: String(route.params['txHash'] ?? ''),
    index: Number(route.params['index'] ?? 0),
  }),
);

const action = computed(() => state.currentAction);
const summary = computed(() => state.currentSummary);
const isInfoAction = computed(() => action.value?.type === 'InfoAction');

const voteDialogOpen = ref(false);

const tab = computed(() => {
  const value = String(route.query['tab'] ?? 'overview');
  return TABS.some(item => item.id === value) ? value : 'overview';
});

interface FractionLike {
  numerator?: number;
  denominator?: number;
}

/** Fraction {numerator, denominator} → 0..1, preserving "unknown". */
function fractionToNumber(fraction: FractionLike | null | undefined): number | undefined {
  if (!fraction) return undefined;
  const { numerator, denominator } = fraction;
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || !denominator) return undefined;
  return numerator / denominator;
}

/**
 * Map the synced protocol parameters into GovThresholdParams — the ONLY place
 * the two shapes meet. Every missing field maps to undefined, never a default:
 * an unknown threshold must render as unknown, not as a guessed mainnet value.
 *
 * Known limitation: db/loaders/network.ts falls back to hardcoded mainnet-2024
 * defaults when the epoch_params row is absent, and that fallback is
 * indistinguishable from real data here. What we CAN detect — epochParams not
 * yet loaded at all — maps to all-undefined.
 */
function toGovThresholdParams(): GovThresholdParams {
  const params = networkStore.epochParams as unknown as {
    dRepVotingThresholds?: Record<string, FractionLike>;
    poolVotingThresholds?: Record<string, FractionLike>;
    minCommitteeSize?: number;
  } | null;
  const drep = params?.dRepVotingThresholds;
  const pool = params?.poolVotingThresholds;
  return {
    dvtMotionNoConfidence: fractionToNumber(drep?.['motionNoConfidence']),
    dvtCommitteeNormal: fractionToNumber(drep?.['committeeNormal']),
    dvtCommitteeNoConfidence: fractionToNumber(drep?.['committeeNoConfidence']),
    dvtUpdateConstitution: fractionToNumber(drep?.['updateConstitution']),
    dvtHardFork: fractionToNumber(drep?.['hardForkInitiation']),
    dvtPpNetwork: fractionToNumber(drep?.['ppNetworkGroup']),
    dvtPpEconomic: fractionToNumber(drep?.['ppEconomicGroup']),
    dvtPpTechnical: fractionToNumber(drep?.['ppTechnicalGroup']),
    dvtPpGov: fractionToNumber(drep?.['ppGovernanceGroup']),
    dvtTreasuryWithdrawal: fractionToNumber(drep?.['treasuryWithdrawal']),
    pvtMotionNoConfidence: fractionToNumber(pool?.['motionNoConfidence']),
    pvtCommitteeNormal: fractionToNumber(pool?.['committeeNormal']),
    pvtCommitteeNoConfidence: fractionToNumber(pool?.['committeeNoConfidence']),
    pvtHardFork: fractionToNumber(pool?.['hardForkInitiation']),
    pvtSecurityGroup: fractionToNumber(pool?.['securityRelevantParamVotingThreshold']),
    committeeMinSize: typeof params?.minCommitteeSize === 'number' ? params.minCommitteeSize : undefined,
  };
}

const drepComposition = computed(() => drepTallies(summary.value));
const spoComposition = computed(() => spoTallies(summary.value));

/** CC votes by member count, not stake — only the server pcts are renderable. */
const ccComposition = computed<Composition>(() => {
  const s = summary.value;
  if (typeof s?.ccYesPct === 'number' || typeof s?.ccNoPct === 'number') {
    return { yesPct: s.ccYesPct ?? null, noPct: s.ccNoPct ?? null, available: true };
  }
  return { yesPct: null, noPct: null, available: false };
});

const ccCounts = computed(() => ccProgress(summary.value, null, null));

interface BodyCard {
  result: BodyResult;
  composition: Composition;
  counts: { yes: number; no: number; abstain: number } | null;
  thresholdNote?: string;
}

/**
 * One card per body that actually votes on this action type. The ParameterChange
 * group scope is passed as null until the payload decoding lands server-side —
 * per CIP-1694 the conservative fallback is the strictest of all four DRep
 * groups with the SPO row OMITTED rather than invented.
 */
const bodyResults = computed<BodyCard[]>(() => {
  if (!action.value || isInfoAction.value) return [];
  const observed = {
    drepYesPct: drepComposition.value.yesPct,
    spoYesPct: spoComposition.value.yesPct,
    ccYesPct: summary.value?.ccYesPct ?? null,
  };
  const results = evaluateThresholds(String(action.value.type), toGovThresholdParams(), observed, null);
  return results.map(result => {
    if (result.body === 'SPO') {
      return { result, composition: spoComposition.value, counts: null };
    }
    if (result.body === 'CC') {
      // The CC threshold is a member-count quorum (ccThreshold is null
      // upstream), so its "unknown threshold" note names the quorum, not the
      // epoch parameters.
      return {
        result,
        composition: ccComposition.value,
        counts: ccCounts.value ? { yes: ccCounts.value.yes, no: ccCounts.value.no, abstain: ccCounts.value.abstain } : null,
        thresholdNote: String(t('governance.quorumUnavailable')),
      };
    }
    return { result, composition: drepComposition.value, counts: null };
  });
});

const typeLabel = computed(() => {
  const type = String(action.value?.type ?? '');
  const key = `governance.actionType.${type.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? type : translated;
});

const title = computed(() => {
  if (action.value?.title) return action.value.title;
  return govActionId.value ? `${govActionId.value.slice(0, 10)}…#${action.value?.index ?? 0}` : '';
});

/** Deposit in ADA. Gov deposits are far below 2^53 lovelace, so the division is exact enough to display. */
const depositAda = computed(() => {
  const lovelace = toLovelace(action.value?.deposit);
  return (Number(lovelace) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 });
});

const epochsLeft = computed(() => {
  if (!isOpen(action.value?.status)) return null;
  return epochsRemaining(currentEpoch.value, action.value?.expiresEpoch);
});

/** Whole-epoch approximation ("about N days") — tip.epoch carries no intra-epoch position. */
const daysLeft = computed(() => {
  if (!isOpen(action.value?.status)) return null;
  return daysRemaining(currentEpoch.value, action.value?.expiresEpoch);
});

/**
 * Why the hash check produced no verdict, when that is knowable.
 *
 * An anchor URL with no verdict AND no document in hand means the document
 * could not be read — a different fact from "the check did not run", and the
 * one the reader can act on (the metadata may be gone, or the host down).
 * When `rawMetadata` IS present a null verdict really is just an unrun check,
 * so the badge keeps its plain "unverified" state.
 */
const anchorFailureReason = computed<'fetchFailed' | null>(() => {
  const value = action.value;
  if (!value?.anchorUrl || value.hashValid !== null) return null;
  return value.rawMetadata === null ? 'fetchFailed' : null;
});

/** Anchor and reference URLs are author-controlled — everything goes through the safe-link parser. */
const anchorHref = computed(() => safeExternalHref(action.value?.anchorUrl));

const referenceLinks = computed(() => toReferenceLinks(action.value?.references));

const referenceHref = computed(() => referenceHrefResolver(referenceLinks.value));

/**
 * Proposal prose, rendered through the shared escape-first markdown renderer.
 *
 * Anyone can submit a governance action, so these three fields are
 * attacker-controlled. `renderMarkdown` escapes every byte to HTML entities
 * BEFORE applying any markdown rule, which is the only reason `v-html` is safe
 * here — it must never receive anything but this function's output.
 */
function renderProse(source: string | null | undefined): string {
  return source ? renderMarkdown(source, { referenceHref: referenceHref.value }) : '';
}

const renderedAbstract = computed(() => renderProse(action.value?.abstractText));
const renderedMotivation = computed(() => renderProse(action.value?.motivation));
const renderedRationale = computed(() => renderProse(action.value?.rationale));

const actionIsOpen = computed(() => isOpen(action.value?.status));

/**
 * Whose position the panel should call out.
 *
 * A wallet delegated to its OWN registered DRep votes as itself, and the two
 * read differently ("You have not voted" vs "Your DRep has not voted"), so the
 * kind travels with the id. Derived from state already in hand — this costs no
 * request, and the keyword DReps are handled downstream rather than filtered
 * out here, because "your delegation is a standing position" is itself the
 * honest answer for them.
 */
const voterIdentity = computed<PositionIdentity | null>(() => {
  const status = governanceStatus({
    account: walletStore.account,
    ownDRepIds: walletStore.keys?.drep129,
  });
  if (!status.drepId) return null;
  return { drepId: status.drepId, kind: status.isSelf ? 'self' : 'delegated' };
});

const formattedGovAction = computed(() => {
  try {
    return JSON.stringify(action.value?.govAction, null, 2);
  } catch {
    return String(action.value?.govAction);
  }
});

function setTab(next: string): void {
  if (next === tab.value) return;
  router.replace({ query: { ...route.query, tab: next } });
}

function reload(): void {
  governanceActionsStore.loadAction(govActionId.value, network.value);
}

function goBack(): void {
  router.push({ name: 'governanceActions' });
}

function loadVotes(): void {
  governanceActionsStore.loadActionVotes(govActionId.value, network.value);
}

/** Only DReps have a profile page; the row withholds the affordance otherwise. */
function openDRep(drepId: string): void {
  if (!drepId) return;
  router.push({ name: 'governanceDRep', params: { drepId } }).catch(() => undefined);
}

// Votes are loaded lazily, the first time the positions tab is opened. The
// guard is `votesLoaded`, not `currentVotes.length`: an action nobody has voted
// on, and one whose lookup failed, would otherwise both re-fetch on every tab
// switch. Retrying after a failure is the retry button's job.
watch(
  () => tab.value,
  next => {
    if (next === 'positions' && !state.votesLoaded && !state.votesLoading) loadVotes();
  },
);

// Navigating between two actions reuses this view — re-load on param change.
watch(
  () => govActionId.value,
  () => reload(),
);

onMounted(() => reload());
</script>

<style scoped>
.action-detail {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.action-detail__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.action-detail__header {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-detail__badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.action-detail__type {
  color: var(--g-text-3);
}
.action-detail__title {
  margin: 0;
  overflow-wrap: anywhere;
}
.action-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-3);
  color: var(--g-text-3);
}
.action-detail__tabs {
  display: flex;
  gap: var(--g-s-2);
  border-bottom: 1px solid var(--g-hairline-1);
}
.action-detail__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--g-text-3);
  padding: var(--g-s-2) var(--g-s-3);
  cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}
.action-detail__tab--active {
  color: var(--g-text-1);
  border-bottom-color: var(--g-accent);
}
.action-detail__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
/* Surface, border and radius all come from `glass-panel` (liquid-glass.css). */
.action-detail__advisory {
  display: flex;
  align-items: flex-start;
  padding: var(--g-s-4);
  color: var(--g-text-2);
}
.action-detail__note {
  margin: 0 0 var(--g-s-1);
  color: var(--g-text-3);
}
.action-detail__tallies {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.action-detail__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-detail__references {
  margin: 0;
  padding-left: var(--g-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-detail__reference::marker {
  color: var(--g-text-3);
}
/* Jumping from a [n] marker in the prose highlights its entry — no JS, no
   animation, just the fragment the marker points at. */
.action-detail__reference:target {
  background: var(--g-raised);
  border-radius: var(--g-r-control);
}
.action-detail__link {
  display: inline-flex;
  align-items: center;
  color: var(--g-text-2);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.action-detail__link:hover {
  color: var(--g-text-1);
}
.action-detail__json {
  margin: 0;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  color: var(--g-text-2);
  overflow-x: auto;
}
</style>
