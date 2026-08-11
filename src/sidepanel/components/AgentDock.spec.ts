// src/sidepanel/components/AgentDock.spec.ts
//
// Covers the Task C support (live chat) layer added to AgentDock.vue. The data
// layer (`@/sidepanel/composables/useSupportChat`) is built by a sibling
// workstream and does not exist in this worktree yet — it's mocked below
// against the agreed contract shape rather than imported for real.
// `@/stores/featureFlagsStore` already exists for real (it exports the named
// `featureFlagsStore` singleton — see NavigationDrawer.vue etc. for the same
// import/call shape) but is mocked here too, alongside
// `@/sidepanel/composables/useAgentDock` (the existing Copilot composable), so
// these tests never touch the real agent provider / network calls, mirroring
// GeroSwapEmbed.spec.ts's pattern of stubbing every collaborator store/composable
// a component imports.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';

type SupportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
interface SupportMessage {
  id: number;
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
interface LiveChatGate {
  enabled: boolean;
}

// vi.mock(...) factories are hoisted above every import in this file — including
// `import ... from 'vue'` — so referencing plain top-level `const` bindings (or `ref()`
// itself, which only becomes available once vue's import resolves) inside them throws
// "Cannot access 'x' before initialization". vi.hoisted() runs in that same early phase
// and is the escape hatch for OUR OWN state (`vi` itself is safe to use inside it), but
// `ref()` still isn't available yet there. So: create plain placeholder objects here
// (mutated in place below, once `vue` has actually loaded, well before any test runs
// `mount()`), and keep every vi.mock(...) factory closed over these SAME object
// references rather than fresh literals.
// See https://vitest.dev/api/vi.html#vi-hoisted.
const { mockSupportChat, mockDock, liveChatGate } = vi.hoisted(() => {
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
    liveChatGate: { enabled: true } as LiveChatGate,
  };
});

function setLiveChatEnabled(on: boolean): void {
  liveChatGate.enabled = on;
}

vi.mock('@/sidepanel/composables/useSupportChat', () => ({
  supportChat: mockSupportChat,
}));

vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { isLiveChatEnabled: () => liveChatGate.enabled },
}));

vi.mock('@/sidepanel/composables/useAgentDock', () => ({
  agentDock: mockDock,
}));

vi.mock('@/sidepanel/composables/useSheetVisibility', () => ({
  useSheetVisibility: () => ({ isAnySheetOpen: sheetOpen }),
}));

import Vue, { ref } from 'vue';

// `ref` is only live from this point on — attach the real reactive properties to the
// SAME objects the mocks above already returned, so any component that captured
// `agentDock`/`supportChat` at import time (a plain object reference) still sees these
// once Vue actually reads `.value` during a later render (mount() only happens inside
// a test's it() callback, well after this module has finished initializing).
const sheetOpen = ref(false);

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

import AgentDock from './AgentDock.vue';

// $t stubbed as identity so assertions can target stable i18n keys instead of
// depending on translated copy (no i18n plugin is installed on the test Vue
// instance — see the CLAUDE.md guidance to check existing spec harnesses;
// none of this repo's component specs render translated text today, so this
// establishes the pattern for the new dock-only spec).
const $t = (key: string): string => key;

interface AgentDockVm {
  mode: 'copilot' | 'support';
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

async function clickSupportToggle(wrapper: Wrapper<Vue>): Promise<void> {
  const buttons = wrapper.findAll('.agent-dock__mode-btn');
  await buttons.at(1).trigger('click');
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
});

describe('AgentDock — Support (live chat) UI', () => {
  it('toggle switches the visible thread from Copilot to Support and back', async () => {
    const wrapper = mountDock();
    expect(wrapper.text()).toContain('copilot.greeting.line1');

    await clickSupportToggle(wrapper);
    expect(wrapper.text()).toContain('support.intro.title');
    expect(wrapper.text()).not.toContain('copilot.greeting.line1');

    const buttons = wrapper.findAll('.agent-dock__mode-btn');
    await buttons.at(0).trigger('click');
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
    const buttons = wrapper.findAll('.agent-dock__mode-btn');
    await buttons.at(0).trigger('click'); // back to copilot
    await buttons.at(1).trigger('click'); // support again
    expect(mockSupportChat.enter).toHaveBeenCalledTimes(2);
  });

  it('marks the support thread as seen once it becomes the visible content', async () => {
    const wrapper = mountDock();
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.markSeen).toHaveBeenCalled();
  });
});

describe('AgentDock — Support send behavior', () => {
  it('clears the draft only when supportChat.send() resolves true', async () => {
    const wrapper = mountDock();
    const vm = vmOf(wrapper);
    vm.mode = 'support';
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(true);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('');
  });

  it('keeps the draft when supportChat.send() resolves false', async () => {
    const wrapper = mountDock();
    const vm = vmOf(wrapper);
    vm.mode = 'support';
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(false);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('hello');
  });

  it('does not call send() for a blank/whitespace-only draft', async () => {
    const wrapper = mountDock();
    const vm = vmOf(wrapper);
    vm.mode = 'support';
    vm.draft = '   ';

    await vm.submit();

    expect(mockSupportChat.send).not.toHaveBeenCalled();
  });

  it('disables the send button while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const sendBtn = wrapper.find('.agent-dock__send');
    expect(sendBtn.attributes('disabled')).toBeDefined();
  });
});

describe('AgentDock — watch-only wallets', () => {
  it('replaces the input with a notice when supportChat.isAvailable is false', async () => {
    mockSupportChat.isAvailable.value = false;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__input input').exists()).toBe(false);
    expect(wrapper.text()).toContain('support.watchOnly.notice');
  });

  it('shows the normal input again in Copilot mode even when support is watch-only-gated', async () => {
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

  it('shows the busy dots while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__busy').exists()).toBe(true);
  });
});
