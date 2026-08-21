<template><div></div></template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router/composables';

// The /governance nav link lands on the actions list — this shell only exists
// so the existing route name (and its gates) keep working.
const router = useRouter();
onMounted(() => router.replace({ name: 'governanceActions' }));
</script>
