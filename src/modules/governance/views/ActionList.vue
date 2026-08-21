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
      <ActionRow
        v-for="action in state.actions"
        :key="action.govActionId"
        :action="action"
        :current-epoch="currentEpoch"
        @select="openAction"
      />
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
  </div>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { parseGovActionId } from '@/shared/utils/govActionId';
import { useTranslation } from '@/shared/composables/useTranslation';
import ActionRow from '@/modules/governance/components/actions/ActionRow.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

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

onMounted(() => reload());
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
</style>
