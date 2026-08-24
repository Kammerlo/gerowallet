<template>
  <BaseDialog
    :isOpen="isOpen"
    :title="t('governance.rationaleDialogTitle')"
    :subtitle="actionTitle || undefined"
    icon="mdi-message-text-outline"
    size="lg"
    :min-height="320"
    :height="640"
    @close="$emit('close')"
  >
    <div class="rationale-dialog">
      <!-- Looking. The document is on someone else's host, so this can be slow. -->
      <div v-if="loading" class="rationale-dialog__loading">
        <v-skeleton-loader type="list-item-three-line" />
        <span class="t-caption rationale-dialog__note">{{ $t('governance.rationaleFetching') }}</span>
      </div>

      <template v-else-if="result && result.status === 'verified'">
        <div class="rationale-dialog__banner rationale-dialog__banner--verified">
          <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
          <span class="t-body-sm rationale-dialog__banner-text">
            {{ $t('governance.anchorVerified') }}
            <span class="rationale-dialog__banner-note">{{ $t('governance.rationaleVerifiedNote') }}</span>
          </span>
        </div>

        <!-- v-html is safe here and ONLY here: every section goes through
             renderMarkdown, which HTML-escapes the author's bytes before it
             applies a single markdown rule. Nothing fetched reaches the DOM as
             markup. See renderMarkdown's header before changing this. -->
        <section v-for="(section, i) in result.sections" :key="i" class="rationale-dialog__section">
          <span v-if="section.labelKey" class="t-label">{{ $t(section.labelKey) }}</span>
          <div class="g-prose" v-html="rendered[i]"></div>
        </section>
      </template>

      <!-- Nothing verified, so nothing rendered. The reader gets the reason and
           a way to read the document themselves, in their own browser. -->
      <div v-else class="rationale-dialog__problem" :class="`rationale-dialog__problem--${tone}`">
        <span class="rationale-dialog__problem-glyph" :class="`rationale-dialog__problem-glyph--${tone}`">
          <v-icon size="20">{{ glyph }}</v-icon>
        </span>
        <span class="t-heading">{{ $t(problemTitleKey) }}</span>
        <p class="t-body-sm rationale-dialog__problem-body">{{ $t(problemBodyKey) }}</p>
      </div>

      <div class="rationale-dialog__foot">
        <a
          v-if="externalHref"
          class="t-body-sm rationale-dialog__link"
          :href="externalHref"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ $t('governance.openDocument') }}<v-icon x-small class="ml-1">mdi-open-in-new</v-icon>
        </a>
        <p class="t-caption rationale-dialog__note">{{ $t('governance.rationaleExternalNote') }}</p>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
/**
 * A vote's published rationale, read-only and hash-checked.
 *
 * The wallet fetches the CIP-136 anchor, hashes the RAW BYTES, and renders the
 * prose only when that hash equals the one recorded on chain with the vote.
 * Anything else — a mismatch, a missing hash, an oversized response, a host the
 * extension cannot reach — renders NO content and offers the link instead.
 * `loadRationale` owns that decision table; this component owns the copy.
 *
 * The one `v-html` in here is fed exclusively by `renderMarkdown`, which escapes
 * every author byte before applying any markdown rule. That ordering is the
 * whole safety argument for showing a document nobody in this codebase wrote.
 */
import { computed, ref, watch } from 'vue';

import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { renderMarkdown } from '@/shared/utils/renderMarkdown';
import { toExternalHref } from '@/modules/governance/utils/govAnchor';
import { loadRationale, type RationaleResult } from '@/modules/governance/dialogs/rationaleDoc';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  /** The vote's `meta_url` — the CIP-136 anchor. */
  url: {
    type: String,
    default: null,
  },
  /** The vote's `meta_hash`, as recorded on chain. */
  hash: {
    type: String,
    default: null,
  },
  /** The governance action this vote was cast on, for the dialog subtitle. */
  actionTitle: {
    type: String,
    default: null,
  },
});

defineEmits(['close']);

const { t } = useTranslation();

const loading = ref(false);
const result = ref<RationaleResult | null>(null);

/** Always available, whatever the fetch did: the reader can open it themselves. */
const externalHref = computed(() => toExternalHref(props.url));

const rendered = computed(() =>
  // `emphasis: true` — a rationale is prose, and authors use `_word_` freely.
  // See renderMarkdown's word-boundary guard for why this stays safe.
  result.value?.status === 'verified'
    ? result.value.sections.map(section => renderMarkdown(section.text, { emphasis: true }))
    : [],
);

/**
 * A mismatch is a warning about the DOCUMENT, not about the voter: an author's
 * host may simply have been re-deployed. It is amber, and the content stays
 * hidden either way.
 */
const TONE: Record<string, string> = {
  mismatch: 'warning',
  unverifiable: 'warning',
  oversize: 'neutral',
  network: 'neutral',
  empty: 'neutral',
};

const failure = computed(() => (result.value?.status === 'failed' ? result.value.reason : null));

const tone = computed(() => (failure.value ? TONE[failure.value] ?? 'neutral' : 'neutral'));

const glyph = computed(() =>
  tone.value === 'warning' ? 'mdi-alert-outline' : 'mdi-file-question-outline',
);

const TITLE_KEYS: Record<string, string> = {
  mismatch: 'governance.anchorMismatch',
  unverifiable: 'governance.rationaleNoHash',
  oversize: 'governance.rationaleTooLarge',
  network: 'governance.anchorFetchFailed',
  empty: 'governance.rationaleEmpty',
};

const BODY_KEYS: Record<string, string> = {
  mismatch: 'governance.rationaleMismatchBody',
  unverifiable: 'governance.rationaleNoHashBody',
  oversize: 'governance.rationaleTooLargeBody',
  network: 'governance.rationaleFetchFailedBody',
  empty: 'governance.rationaleEmptyBody',
};

const problemTitleKey = computed(() => TITLE_KEYS[failure.value ?? 'network'] ?? TITLE_KEYS['network']);
const problemBodyKey = computed(() => BODY_KEYS[failure.value ?? 'network'] ?? BODY_KEYS['network']);

/**
 * One fetch per opening, and none at all while closed: the request leaves the
 * user's machine, so it happens because they asked for this document, never
 * because a row carrying one happened to render.
 */
async function load(): Promise<void> {
  result.value = null;
  if (!props.isOpen || !props.url) return;
  loading.value = true;
  try {
    result.value = await loadRationale({ url: props.url, hash: props.hash });
  } finally {
    loading.value = false;
  }
}

watch(() => [props.isOpen, props.url, props.hash], () => void load(), { immediate: true });
</script>

<style scoped>
.rationale-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-4) var(--g-s-4);
  /* Rationales are documents: they routinely outgrow the dialog, and the
     BaseDialog card does not scroll its slot, so the body scrolls itself. */
  max-height: min(68vh, 640px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.rationale-dialog__loading {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.rationale-dialog__banner {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.rationale-dialog__banner--verified {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.rationale-dialog__banner-text {
  color: var(--g-text-1);
  min-width: 0;
}
.rationale-dialog__banner-note {
  color: var(--g-text-2);
}

.rationale-dialog__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.rationale-dialog__problem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.rationale-dialog__problem--warning {
  border-color: var(--g-warning-line);
}
.rationale-dialog__problem-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--g-btn-h-compact);
  height: var(--g-btn-h-compact);
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  color: var(--g-text-3);
}
.rationale-dialog__problem-glyph--warning {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}
.rationale-dialog__problem-glyph .v-icon {
  color: inherit;
}
.rationale-dialog__problem-body {
  margin: 0;
  color: var(--g-text-2);
}

.rationale-dialog__foot {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin-top: auto;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}
.rationale-dialog__link {
  color: var(--g-accent);
}
.rationale-dialog__note {
  margin: 0;
  color: var(--g-text-3);
}
</style>
