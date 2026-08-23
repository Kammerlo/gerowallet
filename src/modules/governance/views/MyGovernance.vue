<template>
  <div class="my-governance">
    <h1 class="t-title">{{ $t('navigation.governanceMe') }}</h1>
    <EmptyState
      icon="mdi-account-check-outline"
      :message="$t('governance.myGovernanceComingSoon')"
    />
  </div>
</template>

<script setup lang="ts">
// Placeholder shell. The status home (delegation health, how the stake was
// cast, the withdrawal gate) replaces this body; the route, its gates and the
// nav entry are already live so the surface can land without touching them.
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
</script>

<style scoped>
.my-governance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
</style>
