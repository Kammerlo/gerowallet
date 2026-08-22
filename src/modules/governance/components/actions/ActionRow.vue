<template>
  <button type="button" class="action-row" @click="$emit('select', action.govActionId)">
    <div class="action-row__main">
      <div class="action-row__top">
        <span class="action-row__type t-label">{{ typeLabel }}</span>
        <StatusPill :status="action.status" />
      </div>
      <div class="action-row__title t-body">{{ title }}</div>
      <!-- The list endpoint carries no tally fields, so the bar only renders
           when a caller supplies a composition (the detail surface does). -->
      <TallyBar
        v-if="composition"
        :yes-pct="composition.yesPct"
        :no-pct="composition.noPct"
        :threshold-pct="null"
        :available="composition.available"
      />
    </div>
    <div class="action-row__meta">
      <span v-if="epochsLeft !== null" class="action-row__epochs t-caption">
        {{ $t('governance.epochsRemaining', { n: epochsLeft }) }}
      </span>
      <v-icon small class="action-row__chevron">mdi-chevron-right</v-icon>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import type { GovProposal } from '@/api/governance.types';
import type { Composition } from '@/shared/utils/govTally';
import { epochsRemaining, isOpen } from '@/shared/utils/govLifecycle';
import { useTranslation } from '@/shared/composables/useTranslation';
import StatusPill from '@/modules/governance/components/actions/StatusPill.vue';
import TallyBar from '@/modules/governance/components/actions/TallyBar.vue';

// Runtime declaration — `number | null` / `X | null` type literals compile to
// validators containing null, which is not a constructor and warns on every
// render. See AsOf.vue.
const props = defineProps({
  action: { type: Object as PropType<GovProposal>, required: true },
  currentEpoch: { type: Number as PropType<number | null>, default: null },
  composition: { type: Object as PropType<Composition | null>, default: null },
});

defineEmits<{ (e: 'select', govActionId: string): void }>();

const { t } = useTranslation();

const typeLabel = computed(() => {
  const key = `governance.actionType.${String(props.action.type ?? '').toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(props.action.type ?? '') : translated;
});

/** Anchor title when present, otherwise the truncated canonical id. */
const title = computed(() => {
  if (props.action.title) return props.action.title;
  const hash = String(props.action.txHash ?? '');
  return `${hash.slice(0, 10)}…#${props.action.index}`;
});

/** Remaining lifetime — only meaningful while the action is still open. */
const epochsLeft = computed(() => {
  if (!isOpen(props.action.status)) return null;
  return epochsRemaining(props.currentEpoch, props.action.expiresEpoch);
});
</script>

<style scoped>
.action-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  text-align: left;
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}
.action-row:hover {
  background: var(--g-raised);
  border-color: var(--g-hairline-2);
}
.action-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-row__top {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.action-row__type {
  color: var(--g-text-3);
}
.action-row__title {
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-row__meta {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-shrink: 0;
}
.action-row__epochs {
  color: var(--g-text-3);
}
.action-row__chevron {
  color: var(--g-text-3);
}
</style>
