<template>
  <div class="drep-directory">
    <!-- Header -->
    <div class="drep-directory__header">
      <div class="drep-directory__intro">
        <span class="t-label">{{ $t('governance.breadcrumbDReps') }}</span>
        <h1 class="t-title">{{ $t('governance.drepDirectoryTitle') }}</h1>
        <p class="t-body drep-directory__subtitle">
          {{
            totalItems === null
              ? $t('governance.drepDirectorySubtitleShort')
              : $t('governance.drepDirectorySubtitle', { n: formatInt(totalItems) })
          }}
        </p>
      </div>
      <div class="drep-directory__header-side">
        <v-text-field
          v-model="search"
          dense
          outlined
          hide-details
          clearable
          prepend-inner-icon="mdi-magnify"
          class="drep-directory__search"
          :label="$t('governance.searchDReps')"
          :placeholder="$t('governance.drepSearchPlaceholder')"
          :loading="loading"
        />
        <GButton tier="primary" compact @click="matchOpen = true">
          <v-icon small left>mdi-account-search-outline</v-icon>{{ $t('governance.findMatch') }}
        </GButton>
      </div>
    </div>

    <!-- Sort pills. Participation is the default; voting power is only ever an
         explicit user choice, never the order the page arrives in. -->
    <div class="drep-directory__sort">
      <span class="t-label drep-directory__sort-label">{{ $t('governance.sortBy') }}</span>
      <v-chip-group :value="sortKey" column @change="onSort">
        <v-chip v-for="option in SORT_OPTIONS" :key="option" :value="option" small outlined>
          {{ sortLabel(option) }}
        </v-chip>
      </v-chip-group>
    </div>

    <ErrorState v-if="error" :message="error" retryable @retry="reload()" />

    <div v-else-if="loading" class="drep-directory__rows">
      <v-skeleton-loader v-for="n in 6" :key="n" type="list-item-two-line" />
    </div>

    <EmptyState v-else-if="!rows.length" :message="t('governance.noDRepsFound')" />

    <template v-else>
      <!-- Column header -->
      <div class="drep-directory__columns" :class="{ 'drep-directory__grid--focus': focusAvailable }">
        <span class="t-label drep-directory__col-name">{{ $t('governance.dRep') }}</span>
        <span class="t-label drep-directory__col-stat">{{ $t('governance.colParticipation') }}</span>
        <span class="t-label drep-directory__col-stat">{{ $t('governance.colRationale') }}</span>
        <span class="t-label drep-directory__col-pattern">{{ $t('governance.colVotePattern') }}</span>
        <span v-if="focusAvailable" class="t-label drep-directory__col-focus">
          {{ $t('governance.colFocusAreas') }}
        </span>
        <span class="t-label drep-directory__col-power">{{ $t('governance.votingPower') }}</span>
      </div>

      <div class="drep-directory__rows">
        <div
          v-for="row in rows"
          :key="row.key"
          class="drep-directory__row glass-panel"
          :class="{ 'drep-directory__grid--focus': focusAvailable }"
        >
          <!-- Identity -->
          <div class="drep-directory__col-name drep-directory__identity">
            <v-avatar rounded size="36" color="var(--g-raised)" class="drep-directory__avatar">
              <v-img v-if="row.image" :src="row.image" contain>
                <template v-slot:error>
                  <v-icon size="18" color="var(--g-text-3)">mdi-account</v-icon>
                </template>
              </v-img>
              <v-icon v-else size="18" color="var(--g-text-3)">mdi-account</v-icon>
            </v-avatar>
            <span class="drep-directory__identity-text">
              <span class="drep-directory__name-line">
                <button type="button" class="t-body-lg drep-directory__name" @click="openProfile(row.id)">
                  {{ row.name }}
                </button>
                <span
                  v-if="row.status"
                  class="t-caption drep-directory__pill"
                  :class="`drep-directory__pill--${row.status.tone}`"
                >
                  {{ row.status.label }}
                </span>
                <span v-if="row.isCurrent" class="t-caption drep-directory__pill drep-directory__pill--accent">
                  {{ $t('governance.yours') }}
                </span>
              </span>
              <span class="t-caption g-mono drep-directory__id">
                {{ truncate(row.id) }}
                <template v-if="row.stats.delegatorCount !== null">
                  · {{ $t('governance.delegatorCount', { n: formatInt(row.stats.delegatorCount) }) }}
                </template>
              </span>
            </span>
          </div>

          <!-- Participation -->
          <div class="drep-directory__col-stat">
            <template v-if="row.stats.participation.pct !== null">
              <span class="t-body-lg g-num">{{ row.stats.participation.pct }}%</span>
              <span class="drep-directory__bar">
                <span class="drep-directory__bar-fill" :style="{ width: `${row.stats.participation.pct}%` }"></span>
              </span>
            </template>
            <span v-else class="t-caption">{{ $t('governance.pendingStat') }}</span>
          </div>

          <!-- Rationale -->
          <div class="drep-directory__col-stat">
            <template v-if="row.stats.rationaleRate.pct !== null">
              <span class="t-body-lg g-num">{{ row.stats.rationaleRate.pct }}%</span>
              <span class="t-caption">{{ $t('governance.writesReasons') }}</span>
            </template>
            <span v-else class="t-caption">{{ $t('governance.pendingStat') }}</span>
          </div>

          <!-- Vote pattern -->
          <div class="drep-directory__col-pattern">
            <template v-if="row.stats.votePattern.total > 0">
              <span class="drep-directory__pattern" role="img" :aria-label="row.patternLabel">
                <span class="drep-directory__pattern--yes" :style="{ width: `${row.stats.votePattern.yesPct}%` }"></span>
                <span class="drep-directory__pattern--no" :style="{ width: `${row.stats.votePattern.noPct}%` }"></span>
                <span
                  class="drep-directory__pattern--abstain"
                  :style="{ width: `${row.stats.votePattern.abstainPct}%` }"
                ></span>
              </span>
              <span class="t-caption g-num">{{ row.patternLabel }}</span>
            </template>
            <span v-else class="t-caption">{{ $t('governance.noVotesYet') }}</span>
          </div>

          <!-- Focus areas. The whole column is hidden when action types are not
               loaded: inventing a category from a proposal id is not an option. -->
          <div v-if="focusAvailable" class="drep-directory__col-focus">
            <span v-for="area in row.focus" :key="area.type" class="t-caption drep-directory__chip">
              {{ area.label }}
            </span>
          </div>

          <!-- Power + action -->
          <div class="drep-directory__col-power drep-directory__power">
            <span class="drep-directory__power-figures">
              <span class="t-body-lg g-num">{{ row.power }}</span>
              <span v-if="row.inflow" class="t-caption g-num delta-up">{{ row.inflow }}</span>
            </span>
            <GButton
              tier="secondary"
              compact
              :disabled="row.isCurrent"
              :loading="building === row.id"
              @click="onDelegate(row.record)"
            >
              {{ row.isCurrent ? $t('governance.delegated') : $t('governance.delegate') }}
            </GButton>
          </div>
        </div>
      </div>

      <!-- The two predefined options. Not DReps, so they never enter the list or
           the match pool — they are a separate, explicitly labelled choice. -->
      <div ref="predefinedEl" class="drep-directory__predefined">
        <div
          v-for="option in PREDEFINED"
          :key="option.kind"
          :data-choice="option.kind"
          class="drep-directory__predefined-card"
          :class="{ 'drep-directory__predefined-card--highlight': highlightedChoice === option.kind }"
        >
          <v-icon size="18" color="var(--g-text-3)">{{ option.icon }}</v-icon>
          <span class="drep-directory__predefined-text">
            <span class="t-body-lg">{{ $t(option.title) }}</span>
            <span class="t-caption">{{ $t(option.description) }}</span>
          </span>
          <GButton
            tier="secondary"
            compact
            :loading="building === option.id"
            @click="onDelegatePredefined(option.kind)"
          >
            {{ $t('governance.choose') }}
          </GButton>
        </div>
      </div>

      <!-- Footer -->
      <div class="drep-directory__footer">
        <span class="t-caption">
          {{ $t('governance.directoryFooter', { showing: rows.length, total: formatInt(totalItems || 0) }) }}
          ·
          {{
            eligibleCount
              ? $t('governance.statsWindow', { n: eligibleCount })
              : $t('governance.statsWindowPending')
          }}
        </span>
        <AsOf :timestamp="fetchedAt" />
      </div>

      <div v-if="totalPages > 1" class="text-center">
        <v-pagination
          :value="page"
          :length="totalPages"
          :total-visible="5"
          circle
          class="compact-pagination"
          @input="onPage"
        ></v-pagination>
      </div>
    </template>

    <MatchPanel
      :is-open="matchOpen"
      :stats-context="statsContext"
      :seed="shuffleSeed"
      @close="matchOpen = false"
      @delegate="onDelegate"
      @open-profile="openProfile"
    />

    <DRepDelegateDialog
      :isOpen="isDialogOpen"
      :drep="selectedDRep"
      :tx="tx"
      @close="closeDialog()"
    ></DRepDelegateDialog>
  </div>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, nextTick, onMounted, onUnmounted, ref, watch, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router/composables';
import blockchainApi from '@/api/blockchain-api';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { delegationHealth } from '@/shared/composables/useDelegationHealth';
import { drepStats, type DRepRecord, type DRepStats, type DRepStatsContext } from '@/shared/utils/drepStats';
import {
  actionTypeResolverFor,
  drepDisplayName,
  drepImageUrl,
  eligibleActionIdsFor,
  epochInflow,
} from '@/shared/utils/drepView';
import { parseDRepId, sameDRep, toCip129 } from '@/shared/utils/drepId';
import { compareLovelace } from '@/shared/utils/lovelace';
import { formatInt } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import MatchPanel from '@/modules/governance/components/dreps/MatchPanel.vue';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import { useDRepDelegation, type PredefinedDRep } from '@/modules/governance/composables/useDRepDelegation';

/**
 * The DRep directory.
 *
 * The page's job is to let someone judge a representative by their record, so
 * every column is a fact off `/api/dreps` run through `drepStats` — never an
 * opinion. Three neutrality rules shape the code:
 *
 *  - The default order is PARTICIPATION. Voting power is one option among five
 *    and is only ever applied because the user clicked it.
 *  - Ordering is applied to the loaded page, client side, with a BigInt
 *    comparator for power. Ties break on the DRep credential, never on power, so
 *    a tie can never quietly become a power ranking.
 *  - A statistic the data cannot support renders as "pending", not as 0. The
 *    focus-area column disappears entirely when governance actions are not
 *    loaded rather than showing an empty category.
 */

const SORT_OPTIONS = ['participation', 'power', 'rationale', 'delegators', 'recent'] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

const PREDEFINED = [
  {
    kind: 'abstain' as const,
    id: 'drep_always_abstain',
    icon: 'mdi-minus-circle-outline',
    title: 'governance.alwaysAbstain',
    description: 'governance.alwaysAbstainDesc',
  },
  {
    kind: 'noConfidence' as const,
    id: 'drep_always_no_confidence',
    icon: 'mdi-close-circle-outline',
    title: 'governance.alwaysNoConfidence',
    description: 'governance.noConfidenceDesc',
  },
];

const PER_PAGE = 15;

const router = useRouter();
const instance = getCurrentInstance();
const { t } = useTranslation();
const { truncate, toCurrency } = filters;

const { selectedDRep, tx, isDialogOpen, building, delegateToDRep, delegateToPredefined, closeDialog } =
  useDRepDelegation();

const records = ref<DRepRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<number | null>(null);
const page = ref(1);
const totalItems = ref<number | null>(null);
const totalPages = ref(1);
const search = ref('');
const sortKey = ref<SortKey>('participation');
const matchOpen = ref(false);

const actionsState = governanceActionsStore.state;
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

// ---------------------------------------------------------------------------
// Stats context
// ---------------------------------------------------------------------------

/**
 * Any one `proposal_id` off the loaded page. It decides which literal id form
 * the eligible-action list has to be written in — see `eligibleActionIdsFor`.
 */
const sampleProposalId = computed(() => {
  for (const record of records.value) {
    for (const vote of record?.votes ?? []) {
      if (typeof vote?.proposal_id === 'string' && vote.proposal_id.trim()) return vote.proposal_id.trim();
    }
  }
  return null;
});

const typeResolver = computed(() =>
  actionsState.actions.length ? actionTypeResolverFor(actionsState.actions) : null,
);

const eligibleActionIds = computed(() =>
  actionsState.actions.length ? eligibleActionIdsFor(sampleProposalId.value, actionsState.actions) : null,
);

/** How many actions participation is measured against, or 0 when unknown. */
const eligibleCount = computed(() => eligibleActionIds.value?.length ?? actionsState.actions.length);

const statsContext = computed<DRepStatsContext>(() => ({
  // With ids we get an exact window; without them the bare count is the honest
  // fallback the plan calls for. Never both — the ids win when present.
  eligibleActionIds: eligibleActionIds.value ?? undefined,
  totalEligibleActions: eligibleActionIds.value ? undefined : actionsState.actions.length || undefined,
  typeResolver: typeResolver.value ?? undefined,
}));

const focusAvailable = computed(() => typeResolver.value !== null);

/** Stable within an epoch, different per wallet — see `drepMatch`. */
const shuffleSeed = computed(
  () => `${walletStore.loggedWallet?.stakeAddress ?? ''}:${currentEpoch.value ?? 0}`,
);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface StatusPill {
  tone: 'success' | 'warning' | 'neutral';
  label: string;
}

function statusFor(record: DRepRecord): StatusPill | null {
  const health = delegationHealth(record, {
    currentEpoch: currentEpoch.value,
    activityWindow: (networkStore.epochParams as { dRepInactivityPeriod?: number } | null)?.dRepInactivityPeriod ?? null,
  });
  if (health.retired) return { tone: 'neutral', label: String(t('governance.retired')) };
  if (health.expired) return { tone: 'warning', label: String(t('governance.noLongerCounting')) };
  if (health.inactiveSoon && health.epochsLeft !== null) {
    return { tone: 'warning', label: String(t('governance.inactiveInEpochs', { n: health.epochsLeft })) };
  }
  if (record.active === true) return { tone: 'success', label: String(t('governance.status.active')) };
  return null;
}

interface DirectoryRow {
  key: string;
  id: string;
  name: string;
  image?: string;
  record: DRepRecord;
  stats: DRepStats;
  status: StatusPill | null;
  isCurrent: boolean;
  patternLabel: string;
  focus: { type: string; label: string }[];
  power: string;
  inflow: string | null;
}

function typeLabel(type: string): string {
  const key = `governance.actionType.${type.toLowerCase()}`;
  const label = String(t(key));
  return label === key ? type : label;
}

function ada(value: bigint): string {
  const wallet = walletStore.loggedWallet;
  return toCurrency(value.toString(), false, 2, networks.resolveCurrencySymbol(wallet?.chain, wallet?.network), '', true);
}

const enriched = computed<DirectoryRow[]>(() =>
  records.value
    .map(record => {
      const stats = drepStats(record, statsContext.value);
      if (!stats) return null;
      const id = String(record.drep_id ?? '');
      const pattern = stats.votePattern;
      const inflow = epochInflow(record.delegators, currentEpoch.value);
      return {
        key: stats.credentialHex ?? id,
        id,
        name: drepDisplayName(record) ?? truncate(id),
        image: drepImageUrl(record),
        record,
        stats,
        status: statusFor(record),
        isCurrent: sameDRep(id, walletStore.account?.drep_id),
        patternLabel: String(
          t('governance.votePatternSummary', {
            yes: pattern.yesPct ?? 0,
            no: pattern.noPct ?? 0,
            abstain: pattern.abstainPct ?? 0,
          }),
        ),
        // Only the DRep's own top categories; this orders nothing across DReps.
        focus: (stats.focusAreas ?? [])
          .filter(area => area.voted > 0)
          .slice(0, 3)
          .map(area => ({ type: area.type, label: typeLabel(area.type) })),
        power: ada(stats.votingPower),
        inflow: inflow !== null && inflow > 0n ? `+${ada(inflow)}` : null,
      } as DirectoryRow;
    })
    .filter((row): row is DirectoryRow => row !== null),
);

/**
 * Descending by a nullable number, with unknowns LAST and a neutral tie-break.
 * "Pending" is not "worst" — it is unknown, so it never displaces a real figure,
 * and equal figures fall back to the credential rather than to voting power.
 */
function byValueDesc(rows: DirectoryRow[], value: (row: DirectoryRow) => number | null): DirectoryRow[] {
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return a.key.localeCompare(b.key);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.key.localeCompare(b.key);
    return bv - av;
  });
}

const rows = computed<DirectoryRow[]>(() => {
  const list = enriched.value;
  switch (sortKey.value) {
    case 'power':
      // BigInt comparator: Number() on lovelace is lossy above 2^53.
      return [...list].sort(
        (a, b) => compareLovelace(b.stats.votingPower, a.stats.votingPower) || a.key.localeCompare(b.key),
      );
    case 'rationale':
      return byValueDesc(list, row => row.stats.rationaleRate.pct);
    case 'delegators':
      return byValueDesc(list, row => row.stats.delegatorCount);
    case 'recent':
      return byValueDesc(list, row => row.stats.lastVoteBlockTime);
    case 'participation':
    default:
      return byValueDesc(list, row => row.stats.participation.pct);
  }
});

function sortLabel(option: SortKey): string {
  return String(t(`governance.sort.${option}`));
}

function onSort(next: SortKey | undefined): void {
  // v-chip-group clears its value when the active chip is clicked again; the
  // list must always have an order, so fall back to the neutral default.
  sortKey.value = next ?? 'participation';
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * `/api/dreps` matches `drep_id` literally, and the same DRep can be written
 * three ways. Canonicalise a recognised id to CIP-129 (the form the endpoint
 * returns) so a pasted CIP-105 or raw hex still finds its owner.
 */
function searchTerm(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const parsed = parseDRepId(value);
  if (!parsed || parsed.form === 'keyword') return value;
  return toCip129(parsed.credentialHex, parsed.credentialType) ?? value;
}

async function load(nextPage = 1): Promise<void> {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;
  loading.value = true;
  error.value = null;
  page.value = nextPage;
  try {
    const response = await blockchainApi.getDRepsPaginated(
      { page: nextPage, per_page: PER_PAGE, search: searchTerm(search.value) },
      wallet.chain,
      wallet.network,
    );
    records.value = (response?.items ?? []) as DRepRecord[];
    totalItems.value = response?.meta?.total_items ?? null;
    totalPages.value = Math.max(1, response?.meta?.total_pages ?? 1);
    fetchedAt.value = Date.now();
  } catch (err) {
    debugLog('DRepDirectory: load failed', err);
    error.value = err instanceof Error ? err.message : String(t('errors.unknownError'));
    records.value = [];
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  void load(page.value);
}

function onPage(next: number): void {
  void load(next);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(1), 400);
});

function openProfile(drepId: string | null): void {
  if (!drepId) return;
  router.push({ name: 'governanceDRep', params: { drepId } });
}

async function onDelegate(record: DRepRecord): Promise<void> {
  if (sameDRep(record?.drep_id, walletStore.account?.drep_id)) return;
  await delegateToDRep({
    id: String(record?.drep_id ?? ''),
    name: drepDisplayName(record) ?? truncate(String(record?.drep_id ?? '')),
    image: drepImageUrl(record),
    delegators: Array.isArray(record?.delegators) ? record.delegators.length : 0,
    votes: Array.isArray(record?.votes) ? record.votes.length : 0,
    voting_power: drepStats(record)?.votingPower ?? 0n,
    hex: record?.hex ?? undefined,
    has_script: record?.has_script ?? false,
    links: record?.metadata?.meta_json?.body?.['references'],
  });
}

async function onDelegatePredefined(kind: PredefinedDRep): Promise<void> {
  await delegateToPredefined(kind);
}

// ---------------------------------------------------------------------------
// `?choice=` handoff from MyGovernance
// ---------------------------------------------------------------------------

/**
 * MyGovernance's locked-rewards hero routes its abstain / no-confidence cards
 * here as `?choice=`, rather than building the certificate inline. This picks
 * that up, points at the matching card and opens the SAME predefined delegate
 * flow the cards themselves use.
 *
 * It deliberately does not fire on mount. A tab opened straight from that hero
 * mounts well before its wallet data lands, and building then would hit a null
 * `epochParams` or, worse, mistake a not-yet-loaded account for an unregistered
 * stake key and attach a registration certificate the chain would reject. So it
 * waits for the same readiness signal the side-panel handoff waits for.
 */
const pendingChoice = ref<PredefinedDRep | null>(null);
const highlightedChoice = ref<PredefinedDRep | null>(null);
const predefinedEl = ref<HTMLElement | null>(null);

function asChoice(value: unknown): PredefinedDRep | null {
  return value === 'abstain' || value === 'noConfidence' ? value : null;
}

const delegationInputsReady = computed(
  () =>
    !!walletStore.loggedWallet &&
    !walletStore.isSyncing &&
    !!networkStore.epochParams &&
    !!walletStore.keys?.stake?.[0]?.cred &&
    !!walletStore.keys?.payment?.[0]?.address &&
    !!walletStore.utxos,
);

async function runPendingChoice(): Promise<void> {
  const choice = pendingChoice.value;
  if (!choice || !delegationInputsReady.value) return;
  pendingChoice.value = null; // claim it before any await — the watcher can re-fire
  await delegateToPredefined(choice);
}

watch(delegationInputsReady, () => {
  void runPendingChoice();
});

/** Bring the named card into view once the list it sits under has rendered. */
function revealChoice(): void {
  const choice = highlightedChoice.value;
  if (!choice) return;
  void nextTick(() => {
    const card = predefinedEl.value?.querySelector(`[data-choice="${choice}"]`);
    if (!(card instanceof HTMLElement)) return;
    const reducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  });
}

// The cards only exist once rows have rendered, so the scroll waits for data.
watch(rows, () => revealChoice());

onMounted(() => {
  // A `?drep=` deep link from global search pre-fills the search box, exactly
  // as the pre-split surface did.
  const query = instance?.proxy?.$route?.query?.['drep'];
  if (typeof query === 'string' && query) search.value = query;

  const choice = asChoice(instance?.proxy?.$route?.query?.['choice']);
  if (choice) {
    pendingChoice.value = choice;
    highlightedChoice.value = choice;
    // Strip the query once claimed. Leaving it would re-open a signing dialog
    // on every refresh or back-navigation to this URL, which the user never
    // asked for a second time.
    router.replace({ name: 'governanceDReps' }).catch(() => undefined);
    void runPendingChoice();
  }

  void load(1);

  // Governance actions supply the participation denominator and the action-type
  // resolver. They are optional: without them the page still renders, with
  // "pending" statistics and no focus column. A failure is the actions store's
  // to report, not this page's.
  const network = String(walletStore.loggedWallet?.network ?? '');
  if (network && !actionsState.actions.length) {
    void governanceActionsStore.loadActions(network).catch(() => undefined);
  }
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<style scoped>
.drep-directory {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.drep-directory__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}
.drep-directory__intro {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__subtitle {
  margin: 0;
  max-width: 62ch;
}
.drep-directory__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.drep-directory__search {
  width: 260px;
}
.drep-directory__sort {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.drep-directory__sort-label {
  flex-shrink: 0;
}
.drep-directory__columns {
  display: grid;
  grid-template-columns: var(--drep-cols);
  align-items: center;
  gap: var(--g-s-3);
  padding: 0 var(--g-s-4);
}
.drep-directory__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.drep-directory__row {
  display: grid;
  grid-template-columns: var(--drep-cols);
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}
/* One column definition for the header and the rows, so they cannot drift.
   The focus column only exists when governance action types are loaded, so the
   track list is switched by a class rather than inferred from the DOM. */
.drep-directory__columns,
.drep-directory__row {
  --drep-cols: minmax(0, 2.6fr) 96px 96px 148px minmax(0, 1.4fr);
}
.drep-directory__grid--focus {
  --drep-cols: minmax(0, 2.2fr) 96px 96px 148px minmax(0, 1fr) minmax(0, 1.4fr);
}
@media (max-width: 1100px) {
  .drep-directory__columns {
    display: none;
  }
  .drep-directory__columns,
  .drep-directory__row,
  .drep-directory__grid--focus {
    --drep-cols: minmax(0, 1fr);
  }
}
.drep-directory__col-stat,
.drep-directory__col-pattern {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__col-focus {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__identity {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-width: 0;
}
.drep-directory__avatar {
  flex: none;
}
.drep-directory__identity-text {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__name-line {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.drep-directory__name {
  background: none;
  border: none;
  padding: 0;
  color: var(--g-text-1);
  cursor: pointer;
  text-align: left;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drep-directory__name:hover {
  color: var(--g-accent);
}
.drep-directory__id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drep-directory__pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-3);
}
.drep-directory__pill--success {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.drep-directory__pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.drep-directory__pill--accent {
  color: var(--g-accent);
  border-color: var(--g-hairline-3);
}
.drep-directory__bar {
  display: block;
  height: var(--g-s-1);
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}
.drep-directory__bar-fill {
  display: block;
  height: 100%;
  background: var(--g-accent);
  transition: width var(--g-dur-base) var(--g-ease);
}
.drep-directory__pattern {
  display: flex;
  height: 6px;
  border-radius: var(--g-r-pill);
  overflow: hidden;
  background: var(--g-raised);
}
.drep-directory__pattern--yes {
  background: var(--g-success);
}
.drep-directory__pattern--no {
  background: var(--g-error);
}
.drep-directory__pattern--abstain {
  background: var(--g-text-3);
}
.drep-directory__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  color: var(--g-text-2);
}
.drep-directory__power {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
.drep-directory__power-figures {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.drep-directory__predefined {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--g-s-2);
}
.drep-directory__predefined-card {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  border: 1px dashed var(--g-hairline-3);
  border-radius: var(--g-r-card);
}
.drep-directory__predefined-card--highlight {
  border-style: solid;
  border-color: var(--g-accent);
}
.drep-directory__predefined-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.drep-directory__footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
  flex-wrap: wrap;
}
</style>
