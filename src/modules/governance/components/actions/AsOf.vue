<template>
  <span v-if="timestamp" class="as-of t-caption">{{ $t('governance.asOf', { time: formatted }) }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ timestamp: number | null }>();

// Every value on this surface comes from a synced index, not live chain, so it
// is always stamped. Locale-aware short time; the date is implied by recency.
const formatted = computed(() =>
  props.timestamp ? new Date(props.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
);
</script>

<style scoped>
.as-of {
  color: var(--g-text-3);
  font-family: var(--g-font-ui);
}
</style>
