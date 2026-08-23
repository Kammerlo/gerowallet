<template>
  <div class="become-drep">
    <h1 class="t-title">{{ $t('navigation.becomeDRep') }}</h1>
    <EmptyState
      icon="mdi-account-voice"
      :message="$t('governance.becomeDRepComingSoon')"
    />
  </div>
</template>

<script setup lang="ts">
// Placeholder shell. The three-step registration flow (CIP-119 metadata,
// hosting + anchor hash, deposit and submit) replaces this body; the route
// already carries the governance gate plus the voting sub-flag.
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
</script>

<style scoped>
.become-drep {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
</style>
