<template>
  <div class="action-list">
    <div class="action-list__header">
      <div>
        <h1 class="t-title">{{ $t('governance.actionsTitle') }}</h1>
        <p class="action-list__subtitle t-caption">{{ $t('governance.actionsSubtitle') }}</p>
      </div>
      <AsOf :timestamp="state.fetchedAt" />
    </div>

    <div class="action-list__filters">
      <div class="action-list__filter-group">
        <span class="t-label action-list__filter-label">{{ $t('common.type') }}</span>
        <v-chip-group :value="state.filters.type" column @change="onTypeFilter">
          <v-chip :value="null" small outlined>{{ $t('common.all') }}</v-chip>
          <v-chip v-for="ty in ACTION_TYPES" :key="ty" :value="ty" small outlined>{{ typeLabel(ty) }}</v-chip>
        </v-chip-group>
      </div>
      <div class="action-list__filter-group">
        <span class="t-label action-list__filter-label">{{ $t('governance.status') }}</span>
        <v-chip-group :value="state.filters.status" column @change="onStatusFilter">
          <v-chip :value="null" small outlined>{{ $t('common.all') }}</v-chip>
          <v-chip v-for="st in ACTION_STATUSES" :key="st" :value="st" small outlined>{{ statusLabel(st) }}</v-chip>
        </v-chip-group>
      </div>
    </div>

    <ErrorState v-if="state.error" :message="state.error" retryable @retry="reload()" />

    <div v-else-if="state.loading" class="action-list__rows">
      <v-skeleton-loader v-for="n in 6" :key="n" type="list-item-two-line" />
    </div>

    <EmptyState v-else-if="!state.actions.length" :message="$t('governance.noGovernanceProposals')" />

    <div v-else class="action-list__rows">
      <div v-for="action in state.actions" :key="action.govActionId" class="action-list__row">
        <!-- Batch selection: only for actions still open to votes, and only when
             this wallet is a registered DRep whose type can batch-sign. -->
        <label v-if="selectable && isActionOpen(action)" class="action-list__select">
          <input
            type="checkbox"
            class="action-list__checkbox"
            :checked="selected.includes(action.govActionId)"
            :aria-label="$t('governance.selectForVoting')"
            @change="toggleSelect(action.govActionId)"
          />
        </label>
        <ActionRow
          class="action-list__row-item"
          :action="action"
          :current-epoch="currentEpoch"
          @select="openAction"
        />
      </div>
    </div>

    <div v-if="totalPages > 1" class="text-center">
      <v-pagination
        :value="state.page"
        :length="totalPages"
        :total-visible="5"
        circle
        class="compact-pagination"
        @input="onPage"
      ></v-pagination>
    </div>

    <div v-if="selected.length" class="action-list__batch-bar">
      <span class="t-body-2 g-num">{{ $t('governance.selectedCount', { n: selected.length }) }}</span>
      <GButton tier="primary" compact @click="openBatchDialog()">
        {{ $t('governance.voteOnSelected') }}
      </GButton>
    </div>

    <CastVoteDialog
      :is-open="batchDialogOpen"
      :actions="selectedActions"
      @close="batchDialogOpen = false"
      @submitted="clearSelection()"
    />
  </div>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import blockchainApi from '@/api/blockchain-api';
import { parseGovActionId } from '@/shared/utils/govActionId';
import { isOpen } from '@/shared/utils/govLifecycle';
import { useVoting } from '@/shared/composables/useVoting';
import { useTranslation } from '@/shared/composables/useTranslation';
import { debugLog } from '@/utils/debug';
import ActionRow from '@/modules/governance/components/actions/ActionRow.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import CastVoteDialog from '@/modules/governance/dialogs/CastVoteDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import type { GovProposal } from '@/api/governance.types';

/** The seven CIP-1694 action types, as Nexus spells them. */
const ACTION_TYPES = [
  'ParameterChange',
  'HardForkInitiation',
  'TreasuryWithdrawals',
  'NoConfidence',
  'NewCommittee',
  'NewConstitution',
  'InfoAction',
] as const;

const ACTION_STATUSES = ['active', 'ratified', 'enacted', 'expired', 'dropped'] as const;

const router = useRouter();
const { t } = useTranslation();

const state = governanceActionsStore.state;

const network = computed(() => String(walletStore.loggedWallet?.network ?? ''));
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

const totalPages = computed(() =>
  state.total === null ? 1 : Math.max(1, Math.ceil(state.total / state.pageSize)),
);

// ---------------------------------------------------------------------------
// Batch voting selection
// ---------------------------------------------------------------------------

const { capability } = useVoting();

// drep129 is an array like every other key list; watch wallets have an empty
// one — guard it, never index blindly.
const drepId = computed(() => walletStore.keys?.drep129?.[0]?.address ?? '');

/**
 * Whether this wallet's DRep is actually registered on chain. Having a derived
 * DRep key is not registration — only a live DRep record is. Loaded once per
 * mount; a lookup failure leaves it false (selection simply stays hidden).
 */
const isRegisteredDrep = ref(false);

async function loadDrepRegistration(): Promise<void> {
  if (!featureFlagsStore.isGovernanceVotingEnabled()) return;
  if (!drepId.value || !capability.value.canBatch || !walletStore.loggedWallet) return;
  try {
    const record = await blockchainApi.getDRepById(
      drepId.value,
      walletStore.loggedWallet.chain,
      walletStore.loggedWallet.network,
    );
    isRegisteredDrep.value = !!record;
  } catch (error) {
    debugLog('ActionList: DRep registration lookup failed', error);
    isRegisteredDrep.value = false;
  }
}

const selectable = computed(
  () =>
    featureFlagsStore.isGovernanceVotingEnabled() &&
    !!drepId.value &&
    isRegisteredDrep.value &&
    capability.value.canBatch,
);

function isActionOpen(action: GovProposal): boolean {
  return isOpen(action.status);
}

const selected = ref<string[]>([]);
const batchDialogOpen = ref(false);

const selectedActions = computed(() =>
  state.actions.filter(action => selected.value.includes(action.govActionId)),
);

function toggleSelect(govActionId: string): void {
  selected.value = selected.value.includes(govActionId)
    ? selected.value.filter(id => id !== govActionId)
    : [...selected.value, govActionId];
}

function clearSelection(): void {
  selected.value = [];
  batchDialogOpen.value = false;
}

function openBatchDialog(): void {
  if (selectedActions.value.length) batchDialogOpen.value = true;
}

function typeLabel(type: string): string {
  const key = `governance.actionType.${type.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? type : translated;
}

function statusLabel(status: string): string {
  const key = `governance.status.${status.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? status : translated;
}

function reload(page = 1): void {
  // A new page/filter means new rows — a selection kept across it would let
  // "N selected" refer to actions the user can no longer see.
  selected.value = [];
  governanceActionsStore.loadActions(network.value, page);
}

/** Server-side filtering — the list is server-paginated, never filter locally. */
function onTypeFilter(type: string | undefined | null): void {
  governanceActionsStore.setFilters({ type: type ?? null });
  reload();
}

function onStatusFilter(status: string | undefined | null): void {
  governanceActionsStore.setFilters({ status: status ?? null });
  reload();
}

function onPage(page: number): void {
  reload(page);
}

function openAction(govActionId: string): void {
  const parsed = parseGovActionId(govActionId);
  if (!parsed) return;
  router.push({
    name: 'governanceAction',
    params: { txHash: parsed.txHash, index: String(parsed.index) },
  });
}

onMounted(() => {
  reload();
  void loadDrepRegistration();
});
</script>

<style scoped>
.action-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.action-list__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.action-list__subtitle {
  margin: 0;
  color: var(--g-text-3);
}
.action-list__filters {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-list__filter-group {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
.action-list__filter-label {
  color: var(--g-text-3);
  flex-shrink: 0;
  min-width: 48px;
}
.action-list__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-list__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.action-list__row-item {
  flex: 1;
  min-width: 0;
}
.action-list__select {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: var(--g-s-1);
}
.action-list__checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--g-accent);
  cursor: pointer;
}
.action-list__batch-bar {
  position: sticky;
  bottom: var(--g-s-2);
  z-index: var(--g-z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
</style>
