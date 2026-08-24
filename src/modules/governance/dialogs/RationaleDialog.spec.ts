// A rationale is a document on a host nobody in this codebase controls, so the
// only thing that makes it renderable is the blake2b-256 recorded on chain with
// the vote. Every assertion here is about that: text appears ONLY when the hash
// matches, and every other outcome shows a reason plus a way out to the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { blake2bHex } from 'blakejs';

// BaseDialog drags the whole Vuetify overlay stack in. What this file owns is
// the body it renders, so the shell is a plain div that exposes the slot.
// A render function, not a `template`: vitest runs the runtime-only Vue build,
// which compiles nothing at runtime (vue-test-utils compiles `stubs` templates
// itself, but a mocked module is not a stub).
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    name: 'BaseDialog',
    props: ['isOpen', 'title', 'subtitle', 'icon', 'size', 'minHeight', 'height'],
    render(h: (tag: string, data: unknown, children: unknown) => unknown) {
      const self = this as unknown as { $slots: { default?: unknown } };
      return h('div', { class: 'base-dialog' }, self.$slots.default);
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import RationaleDialog from './RationaleDialog.vue';

const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const fetchMock = vi.fn();

/** A CIP-136 document plus the hash its own bytes actually produce. */
function document(body: Record<string, unknown>): { bytes: Uint8Array; hash: string } {
  const bytes = new TextEncoder().encode(JSON.stringify({ hashAlgorithm: 'blake2b-256', body }));
  // Hashed with blakejs directly rather than through the wallet's own helper, so
  // a change to that helper cannot silently agree with itself here.
  return { bytes, hash: blake2bHex(bytes, undefined, 32) };
}

/** A `Response` with only the three members the loader touches. */
function response(bytes: Uint8Array, options: { ok?: boolean; contentLength?: string } = {}) {
  return {
    ok: options.ok ?? true,
    headers: { get: (name: string) => (name === 'content-length' ? options.contentLength ?? null : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function render(props: Record<string, unknown>): Wrapper<Vue> {
  return mount(RationaleDialog, {
    propsData: { isOpen: true, ...props },
    mocks: { $t },
    stubs: { 'v-icon': true, 'v-skeleton-loader': true },
  });
}

/** Let the fetch and the hash settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
  await Vue.nextTick();
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe('RationaleDialog', () => {
  it('renders the rationale once the bytes hash to what the vote recorded', async () => {
    const doc = document({
      summary: 'We voted no.',
      rationaleStatement: 'The **budget** exceeds the treasury cap.',
    });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorVerified');
    expect(html).toContain('We voted no.');
    // Markdown is rendered, and the section keeps the label CIP-136 gives it.
    expect(html).toContain('<strong>budget</strong>');
    expect(html).toContain('dashboard.summary');
    expect(html).toContain('governance.rationale');
  });

  it('escapes an author who writes markup instead of prose', async () => {
    const doc = document({ comment: '<img src=x onerror=alert(1)>' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    // renderMarkdown escapes before it applies a single rule, so the tag is
    // visible text and never an element.
    expect(wrapper.find('.g-prose').element.querySelector('img')).toBeNull();
    expect(wrapper.html()).toContain('&lt;img');
  });

  it('shows nothing but a warning when the file does not match its hash', async () => {
    const doc = document({ comment: 'Rewritten after the vote.' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'a'.repeat(64) });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorMismatch');
    expect(html).toContain('governance.rationaleMismatchBody');
    // The text is discarded, not rendered with a caveat.
    expect(html).not.toContain('Rewritten after the vote.');
    expect(wrapper.find('.g-prose').exists()).toBe(false);
    // And the reader can still go and look for themselves.
    expect(wrapper.find('a').attributes('href')).toBe('https://author.test/r.json');
  });

  it('refuses a document with no on-chain hash to check it against', async () => {
    wrapper = render({ url: 'https://author.test/r.json', hash: null });
    await settle();

    expect(wrapper.html()).toContain('governance.rationaleNoHash');
    // Nothing left the machine: unverifiable is decided before the request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized document on its declared length, before reading a byte', async () => {
    const doc = document({ comment: 'x' });
    const arrayBuffer = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => String(2 * 1024 * 1024) },
      arrayBuffer,
    });

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    expect(wrapper.html()).toContain('governance.rationaleTooLarge');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses a body that overruns the cap even when the header understated it', async () => {
    // A hostile host writes its own headers, so the declared length is a hint
    // and the arrived length is the bound. `rationaleDoc.spec.ts` pins the same
    // rule at the loader; this one proves the dialog reports it as oversize
    // rather than hashing half a megabyte of nothing.
    const bytes = new TextEncoder().encode('x'.repeat(600 * 1024));
    fetchMock.mockResolvedValue(response(bytes, { contentLength: '10' }));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'b'.repeat(64) });
    await settle();

    expect(wrapper.html()).toContain('governance.rationaleTooLarge');
  });

  it('offers the browser when the wallet cannot reach the host at all', async () => {
    fetchMock.mockRejectedValue(new Error('blocked by connect-src'));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'c'.repeat(64) });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorFetchFailed');
    expect(html).toContain('governance.rationaleFetchFailedBody');
    expect(wrapper.find('a').attributes('href')).toBe('https://author.test/r.json');
  });

  it('fetches an ipfs anchor through the proxy and links out to a public gateway', async () => {
    const doc = document({ comment: 'From IPFS.' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: `ipfs://${CID_V1}`, hash: doc.hash });
    await settle();

    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/ipfs?path=${CID_V1}`);
    // The link is for a real browser tab, where the gateway answers normally.
    expect(wrapper.find('a').attributes('href')).toBe(`https://ipfs.io/ipfs/${CID_V1}`);
  });

  it('carries an abort signal, so a host that never answers cannot hang the dialog', async () => {
    const doc = document({ comment: 'ok' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    // No cookies and no cached copy: this is a read of a public document.
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
  });

  it('sends no request at all while it is closed', async () => {
    wrapper = render({ isOpen: false, url: 'https://author.test/r.json', hash: 'd'.repeat(64) });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
