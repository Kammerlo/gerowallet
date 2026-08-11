// src/sidepanel/components/AgentDock.spec.ts
//
// Covers the support (live chat) layer of AgentDock.vue — the DOCK's own
// behavior: which thread renders, what the header status says, when enter() /
// markSeen() / send() fire, and what the flag hides.
//
// Every collaborator is mocked even though all of them now exist for real
// (`useSupportChat`, `featureFlagsStore`, `useAgentDock`, `useSheetVisibility`,
// `SupportAuthPrompt`). That is deliberate unit isolation, not a stand-in for
// something unbuilt: importing them for real would drag in the agent provider,
// Chatwoot REST/ActionCable, Dexie and WebAuthn, making these tests slow, non-
// hermetic, and prone to failing for reasons that have nothing to do with the
// dock. Each collaborator is covered by its own spec (useSupportChat.spec.ts,
// useSupportAuthPrompt.spec.ts, SupportAuthPrompt.spec.ts). Mirrors
// GeroSwapEmbed.spec.ts's pattern of stubbing every collaborator a component
// imports.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';

type SupportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
interface SupportMessage {
  id: number;
  // Optional stable key the real composable is expected to attach so an
  // optimistic (negative-id) message keeps the same vnode across the id swap
  // once the server confirms it — see AgentDock.vue's `:key="m.clientId ?? m.id"`.
  clientId?: number;
  role: 'user' | 'agent';
  text: string;
  agentName?: string;
  createdAt: number;
}
interface MockSupportChat {
  messages: { value: SupportMessage[] };
  busy: { value: boolean };
  connectionState: { value: SupportConnectionState };
  unread: { value: number };
  isAvailable: { value: boolean };
  errorKey: { value: string | null };
  enter: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  markSeen: ReturnType<typeof vi.fn>;
}
interface MockDock {
  isOpen: { value: boolean };
  busy: { value: boolean };
  messages: { value: Array<{ id: number; role: 'user' | 'assistant'; text: string }> };
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}
interface FlagsHolder {
  isLiveChatEnabled: () => boolean;
}
interface SheetVisibility {
  isAnySheetOpen: { value: boolean };
}

// vi.mock(...) factories are hoisted above every import in this file — including
// `import ... from 'vue'` — so referencing plain top-level `const` bindings (or `ref()`
// itself, which only becomes available once vue's import resolves) inside them throws
// "Cannot access 'x' before initialization". vi.hoisted() runs in that same early phase
// and is the escape hatch for OUR OWN state (`vi` itself is safe to use inside it), but
// `ref()` still isn't available yet there. So: create plain placeholder objects here
// for EVERY piece of state a vi.mock(...) factory below closes over (mutated in place
// once `vue` has actually loaded, well before any test runs `mount()`), rather than
// only some of them — a factory that closures over a plain `const` declared outside
// vi.hoisted only "works" if nothing forces it to resolve before that `const` runs,
// which is a fragile accident of file order, not a guarantee.
// See https://vitest.dev/api/vi.html#vi-hoisted.
const { mockSupportChat, mockDock, flagsHolder, sheetVisibility } = vi.hoisted(() => {
  return {
    mockSupportChat: {
      enter: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(true),
      markSeen: vi.fn(),
    } as unknown as MockSupportChat,
    mockDock: {
      open: vi.fn(),
      close: vi.fn(),
      toggle: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockDock,
    // Placeholder closure, REPLACED (not merged) below once a real ref exists — a
    // plain `{ enabled: boolean }` object here would not be Vue-reactive, so
    // AgentDock's `liveChatEnabled` computed would cache its first read forever and
    // never notice setLiveChatEnabled() flipping it later (this bit a real test:
    // asserting a runtime flag-flip while already in Support mode).
    flagsHolder: { isLiveChatEnabled: () => true } as FlagsHolder,
    sheetVisibility: {} as SheetVisibility,
  };
});

vi.mock('@/sidepanel/composables/useSupportChat', () => ({
  supportChat: mockSupportChat,
}));

vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { isLiveChatEnabled: () => flagsHolder.isLiveChatEnabled() },
}));

vi.mock('@/sidepanel/composables/useAgentDock', () => ({
  agentDock: mockDock,
}));

vi.mock('@/sidepanel/composables/useSheetVisibility', () => ({
  useSheetVisibility: () => sheetVisibility,
}));

// The spending-auth dialog is stubbed out wholesale rather than stubbed at mount:
// its real module graph reaches PassKeyAuthButton -> webauthn-prf and
// PassKeyPasswordField -> Dexie, none of which this dock-only spec should load.
// Its own contract (registering/settling the promptAuth hook) is covered by
// useSupportAuthPrompt.spec.ts.
vi.mock('@/sidepanel/components/SupportAuthPrompt.vue', () => ({
  default: { name: 'SupportAuthPrompt', render: (h: (tag: string) => unknown) => h('div') },
}));

import Vue, { ref } from 'vue';

// AgentDock.vue renders raw <v-icon> (Vuetify isn't installed/registered in this
// test's Vue instance) — ignore it as a custom element so Vue doesn't warn on every
// render, mirroring GeroSwapEmbed.spec.ts's handling of its own <gero-swap> element.
Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'v-icon'];

// `ref` is only live from this point on. Reassigning (not Object.assign-merging)
// `flagsHolder.isLiveChatEnabled` to a closure over a real ref is what makes the flag
// genuinely reactive: AgentDock's `computed(() => featureFlagsStore.isLiveChatEnabled())`
// calls through to this closure, so Vue correctly tracks `liveChatEnabledRef` as its
// dependency and recomputes whenever setLiveChatEnabled() below changes it — a plain
// mutated property on a non-reactive object cannot trigger that.
const liveChatEnabledRef = ref(true);
flagsHolder.isLiveChatEnabled = () => liveChatEnabledRef.value;

function setLiveChatEnabled(on: boolean): void {
  liveChatEnabledRef.value = on;
}

// `ref` is also used to back the other mocked collaborators — attach the real reactive
// properties to the SAME objects the mocks above already returned, so any component
// that captured `agentDock`/`supportChat`/the sheet-visibility result at import time (a
// plain object reference) still sees these once Vue actually reads `.value` during a
// later render (mount() only happens inside a test's it() callback, well after this
// module has finished initializing).
Object.assign(sheetVisibility, { isAnySheetOpen: ref(false) });

Object.assign(mockSupportChat, {
  messages: ref<SupportMessage[]>([]),
  busy: ref(false),
  connectionState: ref<SupportConnectionState>('idle'),
  unread: ref(0),
  isAvailable: ref(true),
  errorKey: ref<string | null>(null),
});

Object.assign(mockDock, {
  isOpen: ref(true),
  busy: ref(false),
  messages: ref([]),
});

// @ts-ignore — tsconfig has no `*.vue` module shim, so `tsc` cannot resolve an
// SFC imported from a .ts file. Vite/vitest resolve it fine; this keeps the
// repo's typecheck error count where it was.
import AgentDock from './AgentDock.vue';

// $t stubbed as identity so assertions can target stable i18n keys instead of
// depending on translated copy (no i18n plugin is installed on the test Vue
// instance — see the CLAUDE.md guidance to check existing spec harnesses;
// none of this repo's component specs render translated text today, so this
// establishes the pattern for the new dock-only spec). Note this only stubs
// template `$t(...)` calls — AgentDock.vue's `inputPlaceholder` computed calls the
// real `i18n.t(...)` singleton directly, so its assertions below use the real
// committed us.ts copy instead of raw keys.
const $t = (key: string): string => key;

interface AgentDockVm {
  draft: string;
  submit: () => Promise<void>;
}

// Tracked so afterEach can destroy() it: AgentDock's own watchers (e.g. the
// mark-as-seen watcher) stay live against the shared mockDock/mockSupportChat
// singletons for as long as the component instance exists, so a wrapper left
// mounted from a prior test can still react to state the NEXT test mutates.
let activeWrapper: Wrapper<Vue> | null = null;

function mountDock(): Wrapper<Vue> {
  activeWrapper = mount(AgentDock, { mocks: { $t } });
  return activeWrapper;
}

function vmOf(wrapper: Wrapper<Vue>): AgentDockVm {
  return wrapper.vm as unknown as AgentDockVm;
}

// Selects a header mode-toggle button by its accessible name (its visible text —
// no aria-label duplicates it, see AgentDock.vue) rather than positional
// `buttons.at(0/1)`, so the test still finds the right button if the toggle's
// markup order ever changes.
function findModeButton(wrapper: Wrapper<Vue>, mode: 'copilot' | 'support'): Wrapper<Vue> {
  const label = mode === 'copilot' ? 'support.toggle.copilot' : 'support.toggle.support';
  const match = wrapper.findAll('.agent-dock__mode-btn').wrappers.find((w) => w.text().includes(label));
  if (!match) throw new Error(`mode toggle button not found for: ${mode}`);
  return match;
}

async function clickSupportToggle(wrapper: Wrapper<Vue>): Promise<void> {
  await findModeButton(wrapper, 'support').trigger('click');
}

async function clickCopilotToggle(wrapper: Wrapper<Vue>): Promise<void> {
  await findModeButton(wrapper, 'copilot').trigger('click');
}

beforeEach(() => {
  setLiveChatEnabled(true);

  mockDock.isOpen.value = true;
  mockDock.busy.value = false;
  mockDock.messages.value = [];

  mockSupportChat.messages.value = [];
  mockSupportChat.busy.value = false;
  mockSupportChat.connectionState.value = 'idle';
  mockSupportChat.unread.value = 0;
  mockSupportChat.isAvailable.value = true;
  mockSupportChat.errorKey.value = null;

  vi.clearAllMocks();
});

afterEach(() => {
  activeWrapper?.destroy();
  activeWrapper = null;
});

describe('AgentDock — flag off (isLiveChatEnabled: false)', () => {
  it('renders no mode toggle, no escalation chip, no unread dots — Copilot only, unchanged', async () => {
    setLiveChatEnabled(false);
    mockSupportChat.unread.value = 5; // must still have zero visible effect
    // Likewise a live error: without this the notice assertion below would pass
    // on a null errorKey alone and never exercise the activeMode gate.
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    const wrapper = mountDock();

    expect(wrapper.find('.agent-dock__mode-toggle').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);

    // Original 3 suggestion chips only — no 4th "talk to a human" chip.
    const chips = wrapper.findAll('.chip');
    expect(chips.length).toBe(3);

    // Header status still follows the original copilot busy/ready logic.
    expect(wrapper.find('.agent-dock__status').text()).toBe('copilot.status.ready');

    // Copilot content is what's on screen; support copy never renders.
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');

    // mode can never reach 'support' with no toggle/chip to trigger it, so the
    // singleton's enter()/markSeen() must never fire — also proves the watcher
    // getters never subscribed to supportChat's refs (they'd have no way to
    // call these otherwise unreachable branches).
    await wrapper.vm.$nextTick();
    expect(mockSupportChat.enter).not.toHaveBeenCalled();
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();
  });

  it('flips off at runtime while already in Support mode: falls back to Copilot with no latent support state', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.text()).toContain('support.intro.title');

    // A visible banner BEFORE the flip, so the post-flip assertion proves the
    // activeMode gate hides it rather than passing on an already-null errorKey.
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(true);

    setLiveChatEnabled(false);
    await wrapper.vm.$nextTick();

    // activeMode collapses to 'copilot' the instant the flag drops, even though
    // the internal `mode` ref is still latently 'support' — no half-rendered state.
    expect(wrapper.find('.agent-dock__mode-toggle').exists()).toBe(false);
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);
  });
});

describe('AgentDock — Support (live chat) UI', () => {
  it('toggle switches the visible thread from Copilot to Support and back', async () => {
    const wrapper = mountDock();
    expect(wrapper.text()).toContain('copilot.greeting.line1');

    await clickSupportToggle(wrapper);
    expect(wrapper.text()).toContain('support.intro.title');
    expect(wrapper.text()).not.toContain('copilot.greeting.line1');

    await clickCopilotToggle(wrapper);
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');
  });

  it('the escalation chip in the Copilot empty state switches to Support', async () => {
    const wrapper = mountDock();
    const chips = wrapper.findAll('.chip');
    expect(chips.length).toBe(4);
    await chips.at(3).trigger('click');
    expect(wrapper.text()).toContain('support.intro.title');
  });

  it('calls supportChat.enter() when entering support mode', async () => {
    const wrapper = mountDock();
    expect(mockSupportChat.enter).not.toHaveBeenCalled();
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.enter).toHaveBeenCalledTimes(1);
  });

  it('enter() is idempotent-friendly: re-entering support mode calls enter() again (composable owns dedupe)', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    await clickCopilotToggle(wrapper);
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.enter).toHaveBeenCalledTimes(2);
  });

  it('marks the support thread as seen once it becomes the visible content', async () => {
    const wrapper = mountDock();
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(1);
  });

  it('marks the thread as seen again when the dock is closed and reopened while still in Support mode', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(1);

    mockDock.isOpen.value = false;
    await wrapper.vm.$nextTick();
    mockDock.isOpen.value = true;
    await wrapper.vm.$nextTick();

    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(2);
  });
});

describe('AgentDock — Support send behavior', () => {
  it('clears the draft only when supportChat.send() resolves true', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(true);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('');
  });

  it('keeps the draft when supportChat.send() resolves false', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(false);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('hello');
  });

  it('does not call send() for a blank/whitespace-only draft', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = '   ';

    await vm.submit();

    expect(mockSupportChat.send).not.toHaveBeenCalled();
  });

  it('does not call dock.send() when submitting from Support mode', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello support';

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello support');
    expect(mockDock.send).not.toHaveBeenCalled();
  });

  it('disables the send button while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const sendBtn = wrapper.find('.agent-dock__send');
    expect(sendBtn.attributes('disabled')).toBeDefined();
  });
});

describe('AgentDock — input placeholder', () => {
  it('switches between the copilot and support placeholder text per mode', async () => {
    const wrapper = mountDock();
    // Real i18n singleton values (inputPlaceholder calls i18n.t() directly, not
    // the mocked template $t) — see us.ts for both source strings.
    expect(wrapper.find('.agent-dock__input input').attributes('placeholder')).toBe('Ask Gero anything...');

    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__input input').attributes('placeholder')).toBe('Message support...');
  });
});

describe('AgentDock — wallets support chat cannot serve', () => {
  it('replaces the input with a notice when supportChat.isAvailable is false', async () => {
    mockSupportChat.isAvailable.value = false;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__input input').exists()).toBe(false);
    expect(wrapper.text()).toContain('support.unavailable.notice');
  });

  it('shows the normal input again in Copilot mode even when support is availability-gated', async () => {
    mockSupportChat.isAvailable.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__input input').exists()).toBe(true);
  });
});

describe('AgentDock — unread indicators', () => {
  it('shows a dot on the closed FAB when there are unread support messages', () => {
    mockDock.isOpen.value = false;
    mockSupportChat.unread.value = 2;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(true);
  });

  it('hides the FAB dot once the dock is open', () => {
    mockDock.isOpen.value = true;
    mockSupportChat.unread.value = 2;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(false);
  });

  it('shows a dot on the Support toggle segment while unread and viewing Copilot', () => {
    mockSupportChat.unread.value = 1;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(true);
  });

  it('hides the Support segment dot once the user has switched into Support mode', async () => {
    mockSupportChat.unread.value = 1;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(false);
  });
});

describe('AgentDock — status line mapping', () => {
  const cases: Array<[SupportConnectionState, string]> = [
    ['connecting', 'common.connecting'],
    ['reconnecting', 'support.status.reconnecting'],
    ['unavailable', 'support.status.unavailable'],
    ['connected', 'support.status.ready'],
    ['idle', 'support.status.ready'],
  ];

  for (const [state, key] of cases) {
    it(`maps connectionState "${state}" to $t('${key}')`, async () => {
      mockSupportChat.connectionState.value = state;
      const wrapper = mountDock();
      await clickSupportToggle(wrapper);
      expect(wrapper.find('.agent-dock__status').text()).toBe(key);
    });
  }

  it('shows copilot thinking/ready status while in Copilot mode, independent of connectionState', () => {
    mockSupportChat.connectionState.value = 'unavailable';
    mockDock.busy.value = true;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__status').text()).toBe('copilot.status.thinking');
  });
});

describe('AgentDock — error banner', () => {
  it('renders $t(errorKey) inline when supportChat.errorKey is set', async () => {
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__notice').text()).toBe('support.error.sendFailed');
  });

  it('renders no banner when errorKey is null', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);
  });
});

describe('AgentDock — support message bubbles', () => {
  it('renders agent messages with an agentName caption and falls back to support.agentFallbackName', async () => {
    mockSupportChat.messages.value = [
      { id: 1, role: 'user', text: 'hi', createdAt: 1 },
      { id: 2, role: 'agent', text: 'hello there', agentName: 'Alex', createdAt: 2 },
      { id: 3, role: 'agent', text: 'anything else?', createdAt: 3 },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const names = wrapper.findAll('.agent-dock__agent-name');
    expect(names.length).toBe(2);
    expect(names.at(0).text()).toBe('Alex');
    expect(names.at(1).text()).toBe('support.agentFallbackName');

    // Ordered exactly as given, plain text (no markdown/intent cards).
    const bodies = wrapper.findAll('.agent-dock__text');
    expect(bodies.at(0).text()).toBe('hi');
    expect(bodies.at(1).text()).toBe('hello there');
    expect(bodies.at(2).text()).toBe('anything else?');
    expect(wrapper.find('.agent-dock__md').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__card').exists()).toBe(false);
  });

  it('shows the busy dots with a typing aria-label while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const busy = wrapper.find('.agent-dock__busy');
    expect(busy.exists()).toBe(true);
    expect(busy.attributes('aria-label')).toBe('support.status.typing');
  });
});
