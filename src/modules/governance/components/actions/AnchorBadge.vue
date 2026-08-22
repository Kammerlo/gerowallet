<template>
  <span class="anchor t-caption" :class="`anchor--${tone}`">
    <v-icon x-small :color="iconColor" class="mr-1">{{ icon }}</v-icon>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

// Runtime declaration — `boolean | null` compiles to a `[Boolean, null]`
// validator and warns on every render (null is not a constructor). hashValid is
// deliberately tri-state: null = the check did not run. See AsOf.vue.
const props = defineProps({
  hashValid: { type: Boolean as PropType<boolean | null>, default: null },
  hasAnchor: { type: Boolean, required: true },
});
const { t } = useTranslation();

// `hashValid` is TRI-STATE: null means the check did not run, which is not the
// same as failing — the three states render distinctly.
const tone = computed(() => {
  if (!props.hasAnchor) return 'none';
  if (props.hashValid === true) return 'ok';
  if (props.hashValid === false) return 'bad';
  return 'unknown';
});

const icon = computed(
  () =>
    ({
      ok: 'mdi-shield-check-outline',
      bad: 'mdi-shield-alert-outline',
      unknown: 'mdi-shield-outline',
      none: 'mdi-file-hidden',
    })[tone.value],
);

const iconColor = computed(
  () => ({ ok: 'var(--g-success)', bad: 'var(--g-error)', unknown: 'var(--g-text-3)', none: 'var(--g-text-3)' })[tone.value],
);

const label = computed(() =>
  String(
    t(
      {
        ok: 'governance.anchorVerified',
        bad: 'governance.anchorMismatch',
        unknown: 'governance.anchorUnverified',
        none: 'governance.anchorNone',
      }[tone.value],
    ),
  ),
);
</script>

<style scoped>
.anchor {
  display: inline-flex;
  align-items: center;
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
}
.anchor--ok {
  color: var(--g-success);
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}
.anchor--bad {
  color: var(--g-error);
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
}
.anchor--unknown,
.anchor--none {
  color: var(--g-text-3);
}
</style>
