<template>
  <div class="my-governance">
    <!-- Header -->
    <div class="my-governance__header">
      <div class="my-governance__headline">
        <span class="t-label">{{ $t('navigation.governance') }}</span>
        <h1 class="t-display">{{ $t('navigation.governanceMe') }}</h1>
        <p class="t-body my-governance__subtitle">{{ $t(subtitleKey) }}</p>
      </div>
      <div class="my-governance__header-side">
        <GButton tier="secondary" compact @click="goToDReps()">{{ $t('governance.browseDReps') }}</GButton>
        <GButton tier="secondary" compact @click="goToActions()">{{ $t('governance.actionsTitle') }}</GButton>
        <AsOf :timestamp="fetchedAt" />
      </div>
    </div>

    <ErrorState v-if="error" :message="error" retryable @retry="loadDRep()" />

    <template v-else-if="loading">
      <v-skeleton-loader type="image" class="my-governance__skeleton" />
      <v-skeleton-loader type="list-item-three-line" />
    </template>

    <template v-else>
      <!-- ── The state hero ─────────────────────────────────────────────── -->
      <div class="my-governance__hero" :class="`my-governance__hero--${status.tone}`">
        <div class="my-governance__hero-top">
          <div class="my-governance__hero-headline">
            <span class="t-label">{{ $t('governance.yourVotingStatus') }}</span>
            <div class="my-governance__hero-title">
              <span class="my-governance__dot" :class="`my-governance__dot--${status.tone}`"></span>
              <span class="t-title">{{ $t(status.titleKey) }}</span>
            </div>
            <p class="t-body my-governance__hero-copy">{{ $t(status.descriptionKey) }}</p>
          </div>

          <!-- Who holds the vote, or what is being held back -->
          <div v-if="status.drepId" class="my-governance__drep-chip">
            <span class="my-governance__drep-avatar">
              <v-icon size="16" color="var(--g-accent)">mdi-account-outline</v-icon>
            </span>
            <span class="my-governance__drep-ident">
              <span class="t-body-sm my-governance__drep-name">{{ drepName }}</span>
              <span class="t-caption g-mono my-governance__drep-id">{{ truncate(status.drepId) }}</span>
            </span>
          </div>
          <div v-else-if="status.withdrawalsBlocked" class="my-governance__locked">
            <span class="my-governance__locked-icon">
              <v-icon size="18" color="var(--g-error)">mdi-lock-outline</v-icon>
            </span>
            <span class="my-governance__locked-body">
              <span class="t-label">{{ $t('staking.rewardsAmount') }}</span>
              <span class="t-title g-num">{{ lockedRewardsDisplay }}</span>
              <span class="t-caption my-governance__locked-note">{{ $t('governance.withdrawalLocked') }}</span>
            </span>
            <!-- Attempting the withdrawal is what raises the gate: useWithdrawal
                 stops at the CIP-1694 check and the dialog explains the two
                 ways out, instead of the user meeting the rule at signing. -->
            <GButton tier="tertiary" compact @click="withdraw()">{{ $t('staking.withdraw') }}</GButton>
          </div>
        </div>

        <p v-if="status.recordAvailable" class="t-body my-governance__hero-summary">
          {{ $t('governance.representedSummary', { amount: votingPowerDisplay, votes: formatInt(health.voteCount) }) }}
        </p>

        <!-- Health strip: every number below comes from the DRep's own record -->
        <div v-if="status.recordAvailable" class="my-governance__health">
          <div class="my-governance__tile">
            <span class="t-label">{{ $t('governance.rationaleRecent', { n: health.recentWindow }) }}</span>
            <span class="t-heading g-num">{{ rationaleRecentDisplay }}</span>
            <span class="t-caption">{{ rationaleLongRunDisplay }}</span>
          </div>
          <div class="my-governance__tile">
            <span class="t-label">{{ $t('governance.lastVote') }}</span>
            <span class="t-heading g-num">{{ lastVoteDisplay }}</span>
            <span class="t-caption">{{ activityDisplay }}</span>
          </div>
          <div class="my-governance__tile">
            <span class="t-label">{{ $t('governance.votes') }}</span>
            <span class="t-heading g-num">{{ formatInt(health.voteCount) }}</span>
            <span class="t-caption">{{ expiresDisplay }}</span>
          </div>
        </div>

        <div v-if="heroCta" class="my-governance__hero-actions">
          <GButton :tier="heroCtaTier" @click="heroCta.run()">{{ $t(heroCta.labelKey) }}</GButton>
        </div>
      </div>

      <!-- alerts-panel: wired by delegation-alerts -->
      <DelegationAlertsPanel />

      <!-- ── Registered but undelegated: the three ways to unlock ───────── -->
      <template v-if="status.status === 'registeredNoDRep'">
        <div class="my-governance__choices">
          <div class="my-governance__choice my-governance__choice--featured">
            <div class="my-governance__choice-top">
              <span class="my-governance__choice-icon">
                <v-icon size="18" color="var(--g-accent)">mdi-account-check-outline</v-icon>
              </span>
              <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
            </div>
            <span class="t-heading">{{ $t('governance.delegateToADRep') }}</span>
            <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.delegateChoiceDesc') }}</p>
            <p class="t-caption my-governance__choice-note">{{ $t('governance.delegateChoiceNote') }}</p>
            <GButton tier="primary" block class="my-governance__choice-cta" @click="goToDReps()">
              {{ $t('governance.browseDReps') }}
            </GButton>
          </div>

          <div class="my-governance__choice">
            <div class="my-governance__choice-top">
              <span class="my-governance__choice-icon">
                <v-icon size="18" color="var(--g-text-3)">mdi-minus-circle-outline</v-icon>
              </span>
              <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
            </div>
            <span class="t-heading">{{ $t('governance.alwaysAbstain') }}</span>
            <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.abstainChoiceDesc') }}</p>
            <p class="t-caption my-governance__choice-note">{{ $t('governance.abstainChoiceNote') }}</p>
            <GButton tier="secondary" block class="my-governance__choice-cta" @click="goToDReps('abstain')">
              {{ $t('governance.chooseAbstain') }}
            </GButton>
          </div>

          <div class="my-governance__choice">
            <div class="my-governance__choice-top">
              <span class="my-governance__choice-icon">
                <v-icon size="18" color="var(--g-text-3)">mdi-close-circle-outline</v-icon>
              </span>
              <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
            </div>
            <span class="t-heading">{{ $t('governance.alwaysNoConfidence') }}</span>
            <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.noConfidenceChoiceDesc') }}</p>
            <p class="t-caption my-governance__choice-note">{{ $t('governance.noConfidenceChoiceNote') }}</p>
            <GButton tier="secondary" block class="my-governance__choice-cta" @click="goToDReps('noConfidence')">
              {{ $t('governance.chooseNoConfidence') }}
            </GButton>
          </div>
        </div>

        <div class="my-governance__honesty">
          <v-icon size="16" color="var(--g-accent)">mdi-information-outline</v-icon>
          <p class="t-body-sm my-governance__honesty-text">
            {{ $t('governance.threeChoicesHonesty') }}
            {{ $t('common.learnMore') }}
            <a class="my-governance__link" :href="GOV_TOOLS_URL" target="_blank" rel="noopener noreferrer">{{ $t('governance.govToolsLink') }}</a>
            <span class="my-governance__sep">·</span>
            <a class="my-governance__link" :href="CIP_1694_URL" target="_blank" rel="noopener noreferrer">{{ $t('governance.cip1694') }}</a>
          </p>
        </div>
      </template>

      <!-- ── Delegated: what the stake actually did, and the DRep pitch ── -->
      <div v-else class="my-governance__columns">
        <div class="my-governance__record">
          <div class="my-governance__record-head">
            <span class="t-label">{{ $t('governance.howYourStakeWasCast') }}</span>
            <AsOf :timestamp="fetchedAt" />
          </div>

          <!-- True for a DRep that has never voted AND for the two predefined
               choices, which have no record to show and never will. -->
          <EmptyState
            v-if="!recentVotes.length"
            icon="mdi-vote-outline"
            :message="$t('governance.noVotesYet')"
          />

          <div v-else class="my-governance__rows">
            <div v-for="vote in recentVotes" :key="vote.key" class="my-governance__row">
              <span class="t-caption g-mono my-governance__row-id">{{ truncate(vote.proposalId) }}</span>
              <span v-if="vote.hasRationale" class="my-governance__rationale t-caption">
                {{ $t('governance.rationaleAttached') }}
              </span>
              <span class="my-governance__vote t-caption" :class="`my-governance__vote--${vote.tone}`">
                {{ $t(vote.labelKey) }}
              </span>
              <span class="t-caption my-governance__row-when">{{ vote.when }}</span>
            </div>
          </div>

          <p class="t-caption my-governance__record-note">{{ $t('governance.onlyCastVotesCount') }}</p>
        </div>

        <div class="my-governance__aside">
          <!-- What each state means: the legend the status hero is read against -->
          <div class="my-governance__legend">
            <span class="t-label">{{ $t('governance.statusHelpTitle') }}</span>
            <div v-for="entry in legend" :key="entry.key" class="my-governance__legend-row">
              <span class="my-governance__dot my-governance__dot--small" :class="`my-governance__dot--${entry.tone}`"></span>
              <span class="my-governance__legend-body">
                <span class="t-body-sm my-governance__legend-title">{{ $t(`${entry.key}.title`) }}</span>
                <span class="t-caption">{{ $t(`${entry.key}.description`) }}</span>
              </span>
            </div>
          </div>

          <!-- Become a DRep. Hidden when the wallet already is one. -->
          <div v-if="status.status !== 'selfDRep'" class="my-governance__promo">
            <span class="my-governance__choice-icon">
              <v-icon size="20" color="var(--g-accent)">mdi-shield-check-outline</v-icon>
            </span>
            <span class="t-heading">{{ $t('governance.representYourself') }}</span>
            <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.representYourselfDesc') }}</p>
            <ul class="my-governance__bullets">
              <li class="t-caption">{{ $t('governance.keysNeverLeaveWallet') }}</li>
              <li class="t-caption">{{ $t('governance.publicProfileSigned') }}</li>
              <li class="t-caption">{{ $t('governance.retireAnyTime') }}</li>
            </ul>
            <!-- Always secondary: this card renders in the delegated states,
                 where the alerts panel above owns the screen's one gradient. -->
            <GButton tier="secondary" block class="my-governance__choice-cta" @click="goToRegister()">
              {{ $t('navigation.becomeDRep') }}
            </GButton>
          </div>
        </div>
      </div>
    </template>

    <WithdrawGateDialog :is-open="withdrawalBlocked" @close="closeWithdrawalDialog()" />
  </div>
</template>

<script setup lang="ts">
/**
 * The governance home: what THIS wallet's stake is doing, and how to change it.
 *
 * Everything on the page hangs off ONE derived state (`useGovernanceStatus`)
 * so the hero, the tone and the call to action can never disagree with each
 * other — which is exactly what happened when each card decided for itself.
 *
 * The only fetch here is the delegated DRep's record, once on mount. Every
 * number read off it is stamped with `AsOf`, because it comes from a synced
 * index rather than live chain, and every "n/a" below is a real absence: a
 * DRep with no votes has no rationale rate, and printing 0% would accuse them
 * of withholding rationales nobody asked for.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import blockchainApi from '@/api/blockchain-api';
import { useGovernanceStatus } from '@/shared/composables/useGovernanceStatus';
import type { DelegatedDRepRecord, DRepVoteRecord } from '@/shared/composables/useDelegationHealth';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';
import DelegationAlertsPanel from '@/modules/governance/components/alerts/DelegationAlertsPanel.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatInt } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import WithdrawGateDialog from '@/modules/governance/dialogs/WithdrawGateDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

const { t } = useTranslation();
const router = useRouter();
const { toCurrency, truncate } = filters;

/** Constants, not author-supplied links: safe to render directly. */
const GOV_TOOLS_URL = 'https://gov.tools/';
const CIP_1694_URL = 'https://cips.cardano.org/cip/CIP-1694';

const record = ref<DelegatedDRepRecord | null>(null);
const loading = ref(true);
const error = ref('');
const fetchedAt = ref<number | null>(null);

const { withdraw, withdrawalBlocked, closeWithdrawalDialog } = useWithdrawal();

const status = useGovernanceStatus(() => ({
  account: walletStore.account,
  record: record.value,
  ownDRepIds: walletStore.keys?.drep129,
  currentEpoch: NetworkStore.getCurrentEpoch(),
  activityWindow: networkStore.epochParams?.dRepInactivityPeriod ?? null,
}));

const health = computed(() => status.value.health);

const subtitleKey = computed(() =>
  status.value.withdrawalsBlocked
    ? 'governance.myGovernanceSubtitleLocked'
    : 'governance.myGovernanceSubtitle',
);

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network),
);

// BigInt in, string out: `lockedRewards` is exact lovelace and must never be
// narrowed through Number on the way to the formatter.
const lockedRewardsDisplay = computed(() =>
  toCurrency(status.value.lockedRewards.toString(), false, 2, currencySymbol.value),
);

const votingPowerDisplay = computed(() =>
  toCurrency(walletStore.account?.controlled_amount ?? '0', false, 0, currencySymbol.value, '', true),
);

const notAvailable = computed(() => String(t('common.notAvailable')));

const rationaleRecentDisplay = computed(() =>
  health.value.rationaleRecent === null ? notAvailable.value : `${health.value.rationaleRecent}%`,
);

const rationaleLongRunDisplay = computed(() =>
  health.value.rationaleLongRun === null
    ? String(t('governance.noVotesYet'))
    : String(t('governance.rationaleLongRun', { pct: health.value.rationaleLongRun })),
);

const lastVoteDisplay = computed(() =>
  health.value.epochsSinceVote === null
    ? notAvailable.value
    : String(t('governance.epochsAgo', { n: health.value.epochsSinceVote })),
);

const activityDisplay = computed(() =>
  health.value.epochsLeft === null
    ? notAvailable.value
    : String(t('governance.activeForEpochs', { n: health.value.epochsLeft })),
);

const expiresDisplay = computed(() =>
  record.value?.expires_epoch_no
    ? String(t('governance.expiresEpochLabel', { n: record.value.expires_epoch_no }))
    : String(t('governance.onchainData')),
);

/**
 * CIP-119 `givenName` arrives either as a bare string or as a JSON-LD
 * `{ '@value': … }`. Falls back to the id so the chip is never blank.
 */
const drepName = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream metadata is untyped JSON-LD
  const given = (record.value?.metadata as any)?.meta_json?.body?.givenName;
  const name = typeof given === 'object' && given !== null ? given['@value'] : given;
  const text = String(name ?? '').trim();
  return text.length > 0 ? text : truncate(status.value.drepId ?? '');
});

/** The vote glyphs the record can carry, mapped to copy plus a tone. */
const VOTE_COPY: Record<string, { labelKey: string; tone: string }> = {
  yes: { labelKey: 'governance.votedYes', tone: 'yes' },
  no: { labelKey: 'governance.votedNo', tone: 'no' },
  abstain: { labelKey: 'governance.votedAbstain', tone: 'abstain' },
};

/**
 * The newest votes, one row per proposal.
 *
 * Deduped by `proposal_id` keeping the newest: a DRep may re-vote on the same
 * action before it closes, and only the last one counts on chain, so listing
 * both would overstate their record.
 */
interface VoteRow {
  key: string;
  proposalId: string;
  labelKey: string;
  tone: string;
  hasRationale: boolean;
  when: string;
}

const recentVotes = computed<VoteRow[]>(() => {
  const votes: DRepVoteRecord[] = record.value?.votes ?? [];
  const newestFirst = [...votes].sort((a, b) => (b.block_time ?? -Infinity) - (a.block_time ?? -Infinity));
  const seen = new Set<string>();
  const rows: VoteRow[] = [];
  for (const vote of newestFirst) {
    const proposalId = String(vote.proposal_id ?? '').trim();
    const key = proposalId || `unknown-${rows.length}`;
    if (proposalId && seen.has(proposalId)) continue;
    if (proposalId) seen.add(proposalId);
    const copy = VOTE_COPY[String(vote.vote ?? '').toLowerCase()];
    rows.push({
      key,
      proposalId: proposalId || String(t('common.notAvailable')),
      labelKey: copy?.labelKey ?? 'governance.didNotVote',
      tone: copy?.tone ?? 'none',
      hasRationale: String(vote.meta_url ?? '').trim().length > 0,
      when: vote.block_time ? new Date(vote.block_time * 1000).toLocaleDateString() : '',
    });
    if (rows.length >= 6) break;
  }
  return rows;
});

/** The four states worth explaining, in the order the design canvas lists them. */
const legend = [
  { key: 'governance.status.represented', tone: 'success' },
  { key: 'governance.status.drepInactiveSoon', tone: 'warning' },
  { key: 'governance.status.registeredNoDRep', tone: 'critical' },
  { key: 'governance.status.notInGovernance', tone: 'neutral' },
];

/**
 * The one call to action the current state actually needs. Kept as a single
 * slot so the page can never render two competing primaries.
 */
const heroCta = computed<{ labelKey: string; run: () => void } | null>(() => {
  switch (status.value.status) {
    case 'drepRetired':
    case 'drepInactiveSoon':
      return { labelKey: 'governance.findAReplacement', run: () => goToDReps() };
    case 'selfDRep':
      return { labelKey: 'governance.manageRegistration', run: () => goToRegister() };
    case 'notInGovernance':
      return { labelKey: 'governance.goToStaking', run: () => router.push({ name: 'staking' }) };
    default:
      return null;
  }
});

// A retired or expiring DRep is urgent enough to own the gradient; otherwise
// the promo card downstream keeps it, and there is never more than one.
/**
 * One gradient per screen, and in a delegated state this page is not the one
 * that gets it: the delegation-alerts panel drops into the slot above and
 * raises its own primary ("find a replacement", "review the record") whenever
 * an alert is live. So the page only claims the gradient where no alert can
 * exist, which is exactly where there is no DRep to alert about.
 *
 * That leaves `notInGovernance` (the hero CTA below) and `registeredNoDRep`
 * (the delegate choice card, a branch this hero never renders beside).
 */
const heroCtaTier = computed<'primary' | 'secondary'>(() =>
  status.value.drepId ? 'secondary' : 'primary',
);

function goToDReps(choice?: string): void {
  router.push({ name: 'governanceDReps', query: choice ? { choice } : undefined });
}

function goToActions(): void {
  router.push({ name: 'governanceActions' });
}

function goToRegister(): void {
  router.push({ name: 'governanceRegister' });
}

/**
 * Fetch the delegated DRep's record. Absence is not retirement: a 404 leaves
 * `record` null, `recordAvailable` false, and the health strip hidden rather
 * than reporting a DRep as dead on missing data.
 */
async function loadDRep(): Promise<void> {
  error.value = '';
  const drepId = walletStore.account?.drep_id;
  const wallet = walletStore.loggedWallet;
  if (!drepId || !wallet) {
    record.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    record.value = await blockchainApi.getDRepById(drepId, wallet.chain, wallet.network);
    fetchedAt.value = Date.now();
  } catch (err: unknown) {
    debugLog('MyGovernance: DRep lookup failed', err);
    record.value = null;
    error.value = String(t('governance.drepLookupFailed'));
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadDRep();
});
</script>

<style scoped>
.my-governance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.my-governance__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}
.my-governance__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.my-governance__headline h1 {
  margin: 0;
}
.my-governance__subtitle {
  margin: 0;
}
.my-governance__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.my-governance__skeleton {
  border-radius: var(--g-r-card);
}

/* ---- Hero ---- */
.my-governance__hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-5);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
/* Elevation by hairline, never glow: the top edge carries the state's tone. */
.my-governance__hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--g-hairline-3);
}
.my-governance__hero--success::before { background: var(--g-grad); }
.my-governance__hero--warning::before { background: var(--g-warning); }
.my-governance__hero--critical::before { background: var(--g-error); }
.my-governance__hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}
.my-governance__hero-headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.my-governance__hero-title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.my-governance__hero-copy,
.my-governance__hero-summary {
  margin: 0;
  max-width: 62ch;
}
.my-governance__hero-actions {
  display: flex;
  gap: var(--g-s-2);
}
.my-governance__dot {
  width: 10px;
  height: 10px;
  border-radius: var(--g-r-pill);
  background: var(--g-text-3);
  flex: none;
}
.my-governance__dot--small {
  width: 8px;
  height: 8px;
  margin-top: var(--g-s-1);
}
.my-governance__dot--success { background: var(--g-success); }
.my-governance__dot--warning { background: var(--g-warning); }
.my-governance__dot--critical { background: var(--g-error); }

.my-governance__drep-chip {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-1) var(--g-s-3) var(--g-s-1) var(--g-s-1);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  max-width: 100%;
  min-width: 0;
}
.my-governance__drep-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.my-governance__drep-ident {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.my-governance__drep-name {
  color: var(--g-text-1);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-governance__drep-id {
  word-break: normal;
  line-height: 1.3;
}

.my-governance__locked {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-4) var(--g-s-5);
  background: var(--g-raised);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}
.my-governance__locked-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.my-governance__locked-body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.my-governance__locked-note {
  color: var(--g-error);
  font-weight: 550;
}

/* ---- Health strip ---- */
.my-governance__health {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-3);
}
.my-governance__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

/* ---- The three unlock choices ---- */
.my-governance__choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-4);
}
.my-governance__choice {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-5);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
.my-governance__choice--featured {
  border-color: var(--g-accent);
}
.my-governance__choice-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.my-governance__choice-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.my-governance__badge {
  color: var(--g-success);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  white-space: nowrap;
}
.my-governance__choice-copy,
.my-governance__choice-note {
  margin: 0;
}
.my-governance__choice-cta {
  margin-top: auto;
}

/* ---- Honesty strip ---- */
.my-governance__honesty {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-4) var(--g-s-5);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
.my-governance__honesty-text {
  margin: 0;
}
.my-governance__link {
  color: var(--g-accent);
}
.my-governance__sep {
  color: var(--g-text-3);
}

/* ---- Record + aside ---- */
.my-governance__columns {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--g-s-4);
  align-items: start;
}
.my-governance__record,
.my-governance__legend,
.my-governance__promo {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-5);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
.my-governance__record-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.my-governance__rows {
  display: flex;
  flex-direction: column;
}
.my-governance__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-height: var(--g-row-h-panel);
  border-bottom: 1px solid var(--g-hairline-1);
}
.my-governance__row:last-child {
  border-bottom: none;
}
.my-governance__row-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-governance__row-when {
  width: 88px;
  text-align: right;
  flex: none;
}
.my-governance__rationale {
  color: var(--g-accent);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  white-space: nowrap;
}
.my-governance__vote {
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  white-space: nowrap;
  flex: none;
}
.my-governance__vote--yes {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.my-governance__vote--no {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}
.my-governance__vote--abstain {
  color: var(--g-text-2);
  background: var(--g-raised);
}
.my-governance__record-note {
  margin: 0;
  margin-top: auto;
}
.my-governance__aside {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
.my-governance__legend-row {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.my-governance__legend-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.my-governance__legend-title {
  color: var(--g-text-1);
  font-weight: 550;
}
.my-governance__bullets {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding-left: var(--g-s-4);
}

@media (max-width: 960px) {
  .my-governance__columns,
  .my-governance__choices,
  .my-governance__health {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
