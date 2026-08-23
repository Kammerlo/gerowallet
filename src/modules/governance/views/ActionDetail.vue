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

        <section v-if="action.abstractText" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.abstract') }}</h2>
          <p class="t-body-2 action-detail__prose">{{ action.abstractText }}</p>
        </section>
        <section v-if="action.motivation" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.motivation') }}</h2>
          <p class="t-body-2 action-detail__prose">{{ action.motivation }}</p>
        </section>
        <section v-if="action.rationale" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.rationale') }}</h2>
          <p class="t-body-2 action-detail__prose">{{ action.rationale }}</p>
        </section>

        <section v-if="anchorHref || referenceLinks.length" class="action-detail__section">
          <h2 class="t-heading">{{ $t('governance.references') }}</h2>
          <div class="action-detail__links">
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
            <a
              v-for="(link, i) in referenceLinks"
              :key="`${link.href}-${i}`"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="action-detail__link t-body-2"
            >
              <v-icon x-small class="mr-1">{{ link.icon }}</v-icon>
              {{ link.label }}
            </a>
          </div>
        </section>
      </div>

      <!-- Positions (cast votes) -->
      <div v-else-if="tab === 'positions'" class="action-detail__body">
        <EmptyState v-if="!state.currentVotes.length" :message="$t('governance.noVotesYet')" />
        <div v-else class="action-detail__votes">
          <!-- The votes endpoint returns one row per voter with no timestamp or
               epoch, so a re-vote cannot be ordered against its predecessor.
               What IS certain is that each row is that voter's standing
               position, and that is all this says. -->
          <p class="action-detail__votes-note t-caption">{{ $t('governance.positionsLatestOnly') }}</p>
          <div v-for="(vote, i) in state.currentVotes" :key="i" class="action-detail__vote-row">
            <span class="t-caption action-detail__vote-role">{{ roleLabel(vote.voterRole) }}</span>
            <span class="g-mono t-caption action-detail__vote-voter">{{ voterId(vote) }}</span>
            <span class="t-body-2" :class="`action-detail__vote--${String(vote.vote).toLowerCase()}`">
              {{ voteLabel(vote.vote) }}
            </span>
          </div>
        </div>
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
import { toSafeLinks, safeExternalHref, parseSafeUrl } from '@/shared/utils/externalLink';
import { useTranslation } from '@/shared/composables/useTranslation';
import StatusPill from '@/modules/governance/components/actions/StatusPill.vue';
import AnchorBadge from '@/modules/governance/components/actions/AnchorBadge.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import BodyTallyCard from '@/modules/governance/components/actions/BodyTallyCard.vue';
import VoteCta from '@/modules/governance/components/actions/VoteCta.vue';
import CastVoteDialog from '@/modules/governance/dialogs/CastVoteDialog.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import type { GovVote } from '@/api/governance.types';

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

const referenceLinks = computed(() => {
  const references = action.value?.references ?? [];
  return toSafeLinks(references).map((link, i) => {
    const label = references[i]?.label;
    return { ...link, label: label || parseSafeUrl(link.href)?.hostname || link.href };
  });
});

const formattedGovAction = computed(() => {
  try {
    return JSON.stringify(action.value?.govAction, null, 2);
  } catch {
    return String(action.value?.govAction);
  }
});

function roleLabel(role: string): string {
  const key = { DRep: 'governance.dRep', SPO: 'governance.spo', ConstitutionalCommittee: 'governance.constitutionalCommittee' }[role];
  return key ? String(t(key)) : role;
}

function voteLabel(vote: string): string {
  const key = { Yes: 'common.yes', No: 'common.no', Abstain: 'governance.abstain' }[vote];
  return key ? String(t(key)) : vote;
}

function voterId(vote: GovVote): string {
  const id = vote.drepId || vote.voterHash || '';
  return id.length > 20 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

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

// Votes are loaded lazily, the first time the positions tab is opened.
watch(
  () => tab.value,
  next => {
    if (next === 'positions' && !state.currentVotes.length) {
      governanceActionsStore.loadActionVotes(govActionId.value, network.value);
    }
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
.action-detail__votes-note {
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
.action-detail__prose {
  margin: 0;
  color: var(--g-text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.action-detail__links {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
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
.action-detail__votes {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-detail__vote-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.action-detail__vote-role {
  color: var(--g-text-3);
  flex-shrink: 0;
  min-width: 48px;
}
.action-detail__vote-voter {
  color: var(--g-text-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.action-detail__vote--yes {
  color: var(--g-success);
}
.action-detail__vote--no {
  color: var(--g-error);
}
.action-detail__vote--abstain {
  color: var(--g-text-3);
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
