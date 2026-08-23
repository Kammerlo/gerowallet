// WCAG 2.2 target size (minimum) is 24x24 CSS px, and a vote row carries two
// controls that only just clear it: the voter name, which is a button rather
// than a link because it routes in-app, and the rationale link, whose visible
// content is a short caption plus a tiny icon. Both floors are in the
// stylesheet, and nothing pinned them — a later tidy-up of the scoped styles
// could take either one back out and no test would notice.
//
// The floors are asserted against the component's OWN stylesheet rather than a
// computed style: vitest does not apply an SFC's scoped CSS in happy-dom, so a
// `getComputedStyle` assertion would read 0px and pass no matter what the file
// says. Each case first renders the control and reads its class off the DOM, so
// renaming the class breaks the pin instead of silently unhooking it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import VoteRow from './VoteRow.vue';
import type { PositionRow } from './positions';

// Read beside this spec, not via `new URL('./x', import.meta.url)`: the happy-dom
// environment resolves that against the document base and hands back an http: URL.
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'VoteRow.vue'), 'utf8');

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

function row(over: Partial<PositionRow> = {}): PositionRow {
  return {
    key: 'row-1',
    role: 'DRep',
    id: `drep1${'q'.repeat(50)}`,
    credentialHex: 'aa'.repeat(28),
    drepId: `drep1${'q'.repeat(50)}`,
    vote: 'Yes',
    votedAt: 1787463005,
    hasRationale: true,
    rationaleHref: 'https://example.test/why.json',
    hasScript: false,
    isDRep: true,
    ...over,
  };
}

/** A row carrying both of its controls: a named, routable voter with a rationale. */
function mountRow(props: Record<string, unknown> = {}): Wrapper<Vue> {
  return mount(VoteRow, {
    mocks: { $t },
    propsData: { row: row(), name: 'CryptoCrow', route: { name: 'drep-detail' }, ...props },
    stubs: { 'v-icon': true },
  });
}

/** The declaration block of one rule in the component's scoped stylesheet. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(SOURCE);
  expect(match, `no CSS rule for ${selector}`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/** A px length that rule declares, or null when it declares none. Raising it is fine; dropping it is not. */
function pxOf(selector: string, property: string): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+)px`, 'm').exec(rule(selector));
  return match ? Number(match[1]) : null;
}

describe('VoteRow target size', () => {
  it('keeps a 24px floor on the height of the voter-name button', () => {
    const wrapper = mountRow();
    const name = wrapper.find('.vote-row__name--link');

    expect(name.exists()).toBe(true);
    // A button, so it is a tab stop and Enter/Space work with no key handler.
    expect(name.element.tagName).toBe('BUTTON');
    // The label makes it wider than 24px on its own; the height is what a
    // control styled like a text link otherwise lacks.
    expect(pxOf('.vote-row__name--link', 'min-height')).toBeGreaterThanOrEqual(24);
    wrapper.destroy();
  });

  it('keeps a 24px floor on both axes of the rationale link', () => {
    const wrapper = mountRow();
    const rationale = wrapper.find('.vote-row__rationale');

    expect(rationale.exists()).toBe(true);
    expect(rationale.element.tagName).toBe('A');
    expect(pxOf('.vote-row__rationale', 'min-height')).toBeGreaterThanOrEqual(24);
    // This one can shrink on both axes: its content is a short caption and an
    // x-small icon, so the width floor is load-bearing too.
    expect(pxOf('.vote-row__rationale', 'min-width')).toBeGreaterThanOrEqual(24);
    wrapper.destroy();
  });

  it('has no third control that would need a floor of its own', () => {
    // The pins above cover the row only while these are all of it. A control
    // added later fails here rather than shipping under the minimum unnoticed.
    const wrapper = mountRow();
    const controls = wrapper.findAll('button, a, input, select, textarea, [tabindex]');

    expect(controls).toHaveLength(2);
    expect(controls.at(0).classes()).toContain('vote-row__name--link');
    expect(controls.at(1).classes()).toContain('vote-row__rationale');
    wrapper.destroy();
  });

  it('renders the name as plain text, and no control at all, when nothing routes', () => {
    // The floor only has to hold where a control exists: an unnamed or
    // unroutable voter is text, not a 24px button with nothing behind it.
    const wrapper = mountRow({ name: null, route: null, row: row({ rationaleHref: undefined }) });

    expect(wrapper.find('.vote-row__name--link').exists()).toBe(false);
    expect(wrapper.findAll('button, a')).toHaveLength(0);
    wrapper.destroy();
  });
});
