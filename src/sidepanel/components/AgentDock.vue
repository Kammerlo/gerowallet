<!-- src/sidepanel/components/AgentDock.vue -->
<template>
  <div class="agent-dock">
    <button
      class="agent-dock__fab"
      :class="{ 'is-open': dock.isOpen.value, 'is-hidden': isAnySheetOpen }"
      :aria-label="dock.isOpen.value ? $t('copilot.close') : $t('copilot.open')"
      :tabindex="isAnySheetOpen ? -1 : 0"
      @click="dock.toggle()"
    >
      <v-icon v-if="!dock.isOpen.value" size="22" color="var(--g-accent)">mdi-robot-outline</v-icon>
      <v-icon v-else size="22" color="var(--g-accent)">mdi-close</v-icon>
      <span
        v-if="liveChatEnabled && !dock.isOpen.value && supportChat.unread.value > 0"
        class="agent-dock__fab-dot"
        aria-hidden="true"
      ></span>
    </button>

    <transition name="dock-panel">
      <div v-if="dock.isOpen.value" class="agent-dock__panel">
        <header class="agent-dock__head" :class="{ 'agent-dock__head--with-toggle': liveChatEnabled }">
          <div class="agent-dock__head-text">
            <span class="agent-dock__title">{{ $t('copilot.title') }}</span>
            <span class="agent-dock__status">{{ $t(statusKey) }}</span>
          </div>

          <div v-if="liveChatEnabled" class="agent-dock__mode-toggle" role="tablist">
            <button
              type="button"
              class="agent-dock__mode-btn"
              :class="{ 'is-active': mode === 'copilot' }"
              role="tab"
              :aria-selected="mode === 'copilot'"
              aria-controls="agent-dock-thread"
              @click="enterCopilotMode()"
            >{{ $t('support.toggle.copilot') }}</button>
            <button
              type="button"
              class="agent-dock__mode-btn"
              :class="{ 'is-active': mode === 'support' }"
              role="tab"
              :aria-selected="mode === 'support'"
              aria-controls="agent-dock-thread"
              @click="enterSupportMode()"
            >
              {{ $t('support.toggle.support') }}
              <span
                v-if="mode === 'copilot' && supportChat.unread.value > 0"
                class="agent-dock__unread-dot"
                aria-hidden="true"
              ></span>
            </button>
          </div>

          <button
            class="agent-dock__close"
            :aria-label="$t('copilot.close')"
            @click="dock.close()"
          >
            <v-icon size="18" color="var(--g-text-2)">mdi-close</v-icon>
          </button>
        </header>

        <div
          ref="scroll"
          class="agent-dock__messages"
          :id="liveChatEnabled ? 'agent-dock-thread' : undefined"
          :role="liveChatEnabled ? 'tabpanel' : undefined"
        >
          <template v-if="mode === 'copilot' || !liveChatEnabled">
            <div
              v-if="dock.messages.value.length === 0 && !dock.busy.value"
              class="agent-dock__empty"
            >
              <div class="agent-dock__empty-orb">G</div>
              <p class="agent-dock__empty-h">{{ $t('copilot.greeting.line1') }}</p>
              <p class="agent-dock__empty-sub">{{ $t('copilot.greeting.line2') }}</p>
              <div class="agent-dock__chips">
                <button class="chip" @click="quickSend($t('copilot.suggest.portfolio'))">
                  {{ $t('copilot.suggest.portfolio') }}
                </button>
                <button class="chip" @click="quickSend($t('copilot.suggest.staking'))">
                  {{ $t('copilot.suggest.staking') }}
                </button>
                <button class="chip" @click="quickSend($t('copilot.suggest.swap'))">
                  {{ $t('copilot.suggest.swap') }}
                </button>
                <button v-if="liveChatEnabled" class="chip" @click="enterSupportMode()">
                  {{ $t('support.chip.talkToHuman') }}
                </button>
              </div>
            </div>

            <transition-group name="msg" tag="div" class="agent-dock__list">
              <div
                v-for="m in dock.messages.value"
                :key="m.id"
                :class="['agent-dock__msg', m.role]"
              >
                <div v-if="m.role === 'assistant'" class="agent-dock__avatar">G</div>
                <div class="agent-dock__bubble">
                  <!-- assistant replies are markdown (escaped-first, then rendered); user text stays plain -->
                  <div
                    v-if="m.role === 'assistant'"
                    class="agent-dock__md"
                    v-html="renderMarkdown(m.text)"
                  ></div>
                  <p v-else class="agent-dock__text">{{ m.text }}</p>
                  <div v-if="m.intent" class="agent-dock__card">
                    <ChartCard
                      v-if="m.intent.type === 'chart-token'"
                      :symbol="m.intent.symbol"
                      :asset-id="m.intent.assetId"
                    />
                    <SwapCard
                      v-else-if="m.intent.type === 'swap'"
                      :intent="m.intent.swap"
                    />
                    <StakingCard
                      v-else-if="m.intent.type === 'staking'"
                      :intent="m.intent.staking"
                    />
                    <AllowanceCard v-else-if="m.intent.type === 'allowance'" />
                  </div>
                </div>
              </div>
            </transition-group>

            <div v-if="dock.busy.value" class="agent-dock__msg assistant">
              <div class="agent-dock__avatar">G</div>
              <div class="agent-dock__busy" :aria-label="$t('copilot.status.thinking')">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </template>

          <!-- Support (live chat) thread: same bubble layout as Copilot, but plain text
               only (no markdown, no intent cards) and agent bubbles carry an agentName
               caption. Only reachable when liveChatEnabled — see the header toggle and
               escalation chip above, the only two ways `mode` becomes 'support'. -->
          <template v-else>
            <div v-if="supportChat.errorKey.value" class="agent-dock__notice" role="alert">
              {{ $t(supportChat.errorKey.value) }}
            </div>

            <div
              v-if="supportChat.messages.value.length === 0 && !supportChat.busy.value"
              class="agent-dock__empty"
            >
              <div class="agent-dock__empty-orb">G</div>
              <p class="agent-dock__empty-h">{{ $t('support.intro.title') }}</p>
              <p class="agent-dock__empty-sub">{{ $t('support.intro.line') }}</p>
              <p class="agent-dock__empty-status">{{ $t(statusKey) }}</p>
            </div>

            <transition-group name="msg" tag="div" class="agent-dock__list">
              <div
                v-for="m in supportChat.messages.value"
                :key="m.id"
                :class="['agent-dock__msg', m.role === 'user' ? 'user' : 'assistant']"
              >
                <div v-if="m.role === 'agent'" class="agent-dock__avatar">{{ agentInitial(m.agentName) }}</div>
                <div class="agent-dock__bubble">
                  <span v-if="m.role === 'agent'" class="agent-dock__agent-name">
                    {{ m.agentName || $t('support.agentFallbackName') }}
                  </span>
                  <p class="agent-dock__text">{{ m.text }}</p>
                </div>
              </div>
            </transition-group>

            <div v-if="supportChat.busy.value" class="agent-dock__msg assistant">
              <div class="agent-dock__avatar">{{ agentInitial() }}</div>
              <div class="agent-dock__busy" :aria-label="$t(statusKey)">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </template>
        </div>

        <footer
          v-if="mode === 'support' && liveChatEnabled && !supportChat.isAvailable.value"
          class="agent-dock__input agent-dock__input--notice"
        >
          <p class="agent-dock__watch-only">{{ $t('support.watchOnly.notice') }}</p>
        </footer>
        <footer v-else class="agent-dock__input">
          <input
            v-model="draft"
            :placeholder="inputPlaceholder"
            @keyup.enter="submit()"
          />
          <button
            class="agent-dock__send"
            :disabled="sendDisabled"
            :aria-label="$t('copilot.send')"
            @click="submit()"
          >
            <v-icon size="16" color="var(--g-on-grad)">mdi-send</v-icon>
          </button>
        </footer>
        <p class="agent-dock__disclaimer">{{ $t('copilot.disclaimer') }}</p>
      </div>
    </transition>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue';
import { agentDock } from '@/sidepanel/composables/useAgentDock';
import { renderMarkdown } from '@/services/agent/renderMarkdown';
import { useSheetVisibility } from '@/sidepanel/composables/useSheetVisibility';
import { supportChat } from '@/sidepanel/composables/useSupportChat';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import i18n from '@/plugins/i18n';
import ChartCard from '@/sidepanel/components/agent/ChartCard.vue';
import SwapCard from '@/sidepanel/components/agent/SwapCard.vue';
import StakingCard from '@/sidepanel/components/agent/StakingCard.vue';
import AllowanceCard from '@/sidepanel/components/agent/AllowanceCard.vue';

type DockMode = 'copilot' | 'support';

export default defineComponent({
  name: 'AgentDock',
  components: { ChartCard, SwapCard, StakingCard, AllowanceCard },
  setup() {
    const draft = ref('');
    const dock = agentDock;
    const scroll = ref<HTMLElement | null>(null);
    const { isAnySheetOpen } = useSheetVisibility();

    // Everything support-related is gated behind the live-chat flag. `mode` can
    // only ever flip to 'support' via UI this flag hides (the header toggle and
    // the escalation chip), so flag-off leaves the dock's rendered output and
    // behavior identical to before this feature existed.
    const liveChatEnabled = computed(() => featureFlagsStore.isLiveChatEnabled());
    const mode = ref<DockMode>('copilot');

    function enterCopilotMode(): void {
      mode.value = 'copilot';
    }

    function enterSupportMode(): void {
      mode.value = 'support';
      if (liveChatEnabled.value) void supportChat.enter();
    }

    // The support thread counts as "seen" whenever it is the visible content of
    // an open dock — covers switching into support mode, re-opening the dock
    // while already in support mode, and new messages arriving while it's on screen.
    // The getter only reads supportChat.messages when the flag is on, so with the
    // flag off this watcher never subscribes to the singleton's refs at all.
    watch(
      () =>
        liveChatEnabled.value
          ? [mode.value, dock.isOpen.value, supportChat.messages.value.length]
          : [mode.value, dock.isOpen.value],
      () => {
        if (liveChatEnabled.value && mode.value === 'support' && dock.isOpen.value) {
          supportChat.markSeen();
        }
      },
    );

    // Single source for the header status text (and the support empty-state's
    // status line, which shows the same connection state) — copilot's
    // thinking/ready pair outside support mode, the live-chat connection state inside it.
    const statusKey = computed(() => {
      if (mode.value === 'support' && liveChatEnabled.value) {
        const state = supportChat.connectionState.value;
        if (state === 'connecting') return 'common.connecting';
        if (state === 'reconnecting') return 'support.status.reconnecting';
        if (state === 'unavailable') return 'support.status.unavailable';
        return 'support.status.ready'; // 'connected' or 'idle'
      }
      return dock.busy.value ? 'copilot.status.thinking' : 'copilot.status.ready';
    });

    const sendDisabled = computed(() =>
      mode.value === 'support' && liveChatEnabled.value ? supportChat.busy.value : dock.busy.value,
    );

    const inputPlaceholder = computed(() =>
      mode.value === 'support' && liveChatEnabled.value
        ? (i18n.t('support.placeholder') as string)
        : (i18n.t('copilot.placeholder') as string),
    );

    function agentInitial(agentName?: string): string {
      const name = agentName || (i18n.t('support.agentFallbackName') as string);
      return (name || 'S').trim().charAt(0).toUpperCase() || 'S';
    }

    // Nothing may compete for attention while the user is mid-flow —
    // signing above all. Close the chat panel the instant a sheet opens
    // (the FAB itself just fades out via the is-hidden class below), and
    // reopening it is one tap away once the sheet closes.
    watch(isAnySheetOpen, (open) => {
      if (open && dock.isOpen.value) dock.close();
    });

    async function submit(): Promise<void> {
      if (mode.value === 'support' && liveChatEnabled.value) {
        const text = draft.value;
        if (!text.trim() || supportChat.busy.value) return;
        // The composable owns the draft on failure: only clear it once send()
        // confirms the message actually went out, so a dropped connection never
        // silently discards what the user typed.
        const sent = await supportChat.send(text);
        if (sent) draft.value = '';
        return;
      }
      const text = draft.value;
      draft.value = '';
      await dock.send(text);
    }

    function quickSend(text: string): void {
      draft.value = text;
      void submit();
    }

    watch(
      () => [dock.messages.value.length, dock.busy.value],
      () => {
        void nextTick(() => {
          const el = scroll.value;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      },
    );

    // Mirrors the watcher above for the support thread, kept separate so the
    // original copilot scroll behavior above is untouched. As above, the getter
    // only reads supportChat.messages/busy when the flag is on, so flag-off never
    // subscribes to the singleton's refs.
    watch(
      () => (liveChatEnabled.value ? [supportChat.messages.value.length, supportChat.busy.value] : []),
      () => {
        if (mode.value !== 'support') return;
        void nextTick(() => {
          const el = scroll.value;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      },
    );

    return {
      draft,
      dock,
      submit,
      quickSend,
      scroll,
      renderMarkdown,
      isAnySheetOpen,
      mode,
      liveChatEnabled,
      supportChat,
      statusKey,
      sendDisabled,
      inputPlaceholder,
      enterCopilotMode,
      enterSupportMode,
      agentInitial,
    };
  },
});
</script>

<style scoped>
.agent-dock {
  --surface: var(--g-overlay);
  --surface-border: color-mix(in srgb, var(--g-accent) 22%, transparent);
  --text-primary: var(--g-text-1);
  --text-muted: var(--g-text-3);
  --text-placeholder: var(--g-text-3);
  --accent: var(--g-accent);
  --accent-08: color-mix(in srgb, var(--g-accent) 8%, transparent);
  --accent-12: color-mix(in srgb, var(--g-accent) 12%, transparent);
  --accent-14: color-mix(in srgb, var(--g-accent) 14%, transparent);
  --accent-18: color-mix(in srgb, var(--g-accent) 18%, transparent);
  --accent-30: color-mix(in srgb, var(--g-accent) 30%, transparent);
  --accent-35: color-mix(in srgb, var(--g-accent) 35%, transparent);
  --accent-60: color-mix(in srgb, var(--g-accent) 60%, transparent);
  --accent-80: color-mix(in srgb, var(--g-accent) 80%, transparent);
  --user-bubble-bg: color-mix(in srgb, var(--g-accent) 14%, transparent);
  --asst-bubble-bg: var(--g-hairline-1);
  --asst-bubble-border: var(--g-hairline-1);
  --input-bg: var(--g-hairline-1);
  --input-border: var(--g-hairline-2);
  --divider: var(--g-hairline-1);
  --panel-shadow: var(--g-shadow-menu);
  --fab-bg: var(--g-overlay);
  --fab-shadow: var(--g-shadow-menu);
  --gradient-send: var(--g-grad);
}

/* ── FAB ──────────────────────────────────────────────────────────────── */
.agent-dock__fab {
  position: fixed;
  bottom: 80px;
  right: 16px;
  z-index: var(--g-z-dock);
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  background: var(--fab-bg);
  border: 1.5px solid var(--accent-35);
  box-shadow: var(--fab-shadow);
  transition: box-shadow 150ms ease, border-color 150ms ease;
}

.agent-dock__fab:hover {
  box-shadow: var(--fab-shadow), 0 0 0 3px color-mix(in srgb, var(--g-accent) 20%, transparent);
}

.agent-dock__fab.is-open {
  border: 1.5px solid var(--accent-80);
}

/* Nothing may compete for attention while the user reviews a sheet — most of
   all a signing request. Faded rather than unmounted so it resumes exactly
   where it was the instant the sheet closes. */
.agent-dock__fab.is-hidden {
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

.agent-dock__fab-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-accent);
  border: 1px solid var(--fab-bg);
}

/* ── Panel ────────────────────────────────────────────────────────────── */
.agent-dock__panel {
  position: fixed;
  bottom: 140px;
  right: 16px;
  z-index: var(--g-z-dock);
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--g-r-sheet);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--surface-border);
  box-shadow: var(--panel-shadow);
}

.agent-dock__head,
.agent-dock__messages,
.agent-dock__input,
.agent-dock__disclaimer {
  position: relative;
  z-index: 1;
}

/* ── Header ───────────────────────────────────────────────────────────── */
.agent-dock__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
  border-bottom: 1px solid var(--divider);
}

/* Only applied when the mode toggle renders (liveChatEnabled) — the flag-off
   header keeps the original two-item space-between layout untouched above. */
.agent-dock__head--with-toggle {
  justify-content: flex-start;
  gap: 8px;
}

.agent-dock__head-text {
  display: flex;
  flex-direction: column;
}

.agent-dock__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.agent-dock__status {
  font-size: 11px;
  color: var(--g-accent);
}

/* ── Mode toggle (Copilot / Support) ─────────────────────────────────── */
.agent-dock__mode-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--g-r-pill);
  background: var(--accent-08);
  border: 1px solid var(--divider);
}

.agent-dock__mode-btn {
  position: relative;
  height: 22px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: var(--g-r-pill);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;
}

.agent-dock__mode-btn.is-active {
  color: var(--g-accent);
  background: var(--accent-14);
}

.agent-dock__unread-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-accent);
}

.agent-dock__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: color 150ms ease;
}

/* With the toggle in play the header is a flex-start row (see
   .agent-dock__head--with-toggle above), so the close button needs its own
   push-to-the-end instead of relying on justify-content: space-between. */
.agent-dock__head--with-toggle .agent-dock__close {
  margin-left: auto;
  flex-shrink: 0;
}

.agent-dock__close:hover :deep(.v-icon) {
  color: var(--g-text-1) !important;
}

/* ── Messages ─────────────────────────────────────────────────────────── */
.agent-dock__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-dock__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Support error banner ─────────────────────────────────────────────── */
.agent-dock__notice {
  flex-shrink: 0;
  padding: 8px 10px;
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 12px;
  line-height: 1.5;
}

/* ── Support agent-name caption ───────────────────────────────────────── */
.agent-dock__agent-name {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.agent-dock__messages::-webkit-scrollbar {
  width: 4px;
}

.agent-dock__messages::-webkit-scrollbar-track {
  background: transparent;
}

.agent-dock__messages::-webkit-scrollbar-thumb {
  background: var(--accent-30);
  border-radius: 4px;
}

.agent-dock__msg {
  display: flex;
}

.agent-dock__msg.user {
  justify-content: flex-end;
}

.agent-dock__msg.assistant {
  justify-content: flex-start;
}

.agent-dock__avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-self: flex-start;
  margin-right: 6px;
  margin-top: 2px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.agent-dock__bubble {
  max-width: 88%;
}

.agent-dock__msg.user .agent-dock__bubble {
  background: var(--user-bubble-bg);
  border: 1px solid var(--accent-35);
  border-radius: var(--g-r-sheet) var(--g-r-sheet) var(--g-r-chip) var(--g-r-sheet);
  padding: 9px 13px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}

.agent-dock__msg.assistant .agent-dock__bubble {
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: var(--g-r-chip) var(--g-r-sheet) var(--g-r-sheet) var(--g-r-sheet);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.agent-dock__text {
  margin: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ── Rendered markdown (assistant replies; v-html, so children need :deep) ─ */
.agent-dock__md {
  margin: 0;
  word-break: break-word;
}

.agent-dock__md :deep(p) {
  margin: 0 0 8px;
}

.agent-dock__md :deep(p:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(strong) {
  font-weight: 700;
  color: var(--g-text-1);
}

.agent-dock__md :deep(ul),
.agent-dock__md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.agent-dock__md :deep(ul:last-child),
.agent-dock__md :deep(ol:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(li) {
  margin: 3px 0;
}

.agent-dock__md :deep(li::marker) {
  color: var(--accent-60);
}

.agent-dock__md :deep(code) {
  font-family: var(--g-font-mono);
  font-size: 12px;
  background: var(--accent-12);
  color: var(--g-accent);
  padding: 1px 5px;
  border-radius: var(--g-r-chip);
  word-break: break-all;
}

.agent-dock__md :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-dock__md :deep(.md-h) {
  font-weight: 700;
  color: var(--g-text-1);
  margin: 8px 0 4px;
}

.agent-dock__md :deep(.md-h:first-child) {
  margin-top: 0;
}

.agent-dock__md :deep(.md-h1) {
  font-size: 16px;
}

.agent-dock__md :deep(.md-h2) {
  font-size: 14px;
}

.agent-dock__md :deep(.md-h3) {
  font-size: 13px;
}

.agent-dock__card {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--g-accent) 12%, transparent);
  padding-top: 8px;
}

/* ── Thinking indicator ───────────────────────────────────────────────── */
.agent-dock__busy {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: var(--g-r-chip) var(--g-r-sheet) var(--g-r-sheet) var(--g-r-sheet);
  padding: 10px 14px;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--g-accent);
  display: inline-block;
  margin: 0 2px;
  animation: dot-pulse 1.1s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 160ms;
}

.dot:nth-child(3) {
  animation-delay: 320ms;
}

@keyframes dot-pulse {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  30% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* ── Empty state ──────────────────────────────────────────────────────── */
.agent-dock__empty {
  padding: 8px 6px 4px;
  animation: msg-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-dock__empty-orb {
  width: 32px;
  height: 32px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--accent-12);
  border: 1px solid var(--accent-30);
  font-size: 16px;
  font-weight: 700;
  color: var(--g-accent);
  line-height: 32px;
  text-align: center;
}

.agent-dock__empty-h {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  text-align: center;
}

.agent-dock__empty-sub {
  font-size: 12px;
  color: var(--g-text-2);
  margin: 0;
  text-align: center;
}

.agent-dock__empty-status {
  font-size: 11px;
  color: var(--g-accent);
  margin: 10px 0 0;
  text-align: center;
}

.agent-dock__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 16px;
}

.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  background: var(--accent-08);
  border: 1px solid var(--accent-30);
  font-size: 11px;
  font-weight: 500;
  color: var(--g-accent);
  cursor: pointer;
  transition: background 120ms ease;
}

.chip:hover {
  background: var(--accent-18);
}

/* ── Input footer ─────────────────────────────────────────────────────── */
.agent-dock__input {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid var(--divider);
  background: transparent;
}

.agent-dock__input--notice {
  justify-content: center;
}

.agent-dock__watch-only {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.agent-dock__input input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  caret-color: var(--accent);
  outline: none;
  transition: border-color 180ms ease;
}

.agent-dock__input input::placeholder {
  color: var(--text-placeholder);
}

.agent-dock__input input:focus {
  border-color: var(--accent-60);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-accent) 15%, transparent);
}

.agent-dock__send {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  border: none;
  cursor: pointer;
  background: var(--gradient-send);
  transition: opacity 150ms ease, box-shadow 150ms ease;
}

.agent-dock__send:disabled {
  opacity: 0.35;
  cursor: default;
}

.agent-dock__send:hover:not(:disabled) {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-accent) 25%, transparent);
}

/* ── Disclaimer ───────────────────────────────────────────────────────── */
.agent-dock__disclaimer {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 14px 10px;
  margin: 0;
  text-align: center;
}

/* ── Panel open/close transition ──────────────────────────────────────── */
.dock-panel-enter-active {
  animation: panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.dock-panel-leave-active {
  animation: panel-out 160ms cubic-bezier(0.4, 0, 1, 1) both;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes panel-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* ── Message entrance transition ──────────────────────────────────────── */
.msg-enter-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.msg-enter {
  opacity: 0;
}

.agent-dock__msg.assistant.msg-enter {
  transform: translateX(-16px);
}

.agent-dock__msg.user.msg-enter {
  transform: translateX(16px);
}

.msg-enter-to {
  transform: translateX(0);
  opacity: 1;
}
</style>
