/**
 * Safe markdown -> HTML, injected via `v-html`.
 *
 * SAFETY MODEL (do not change the order): ALL input is HTML-escaped FIRST, then
 * a small markdown subset is rendered on the escaped text. Nothing an author
 * wrote can ever reach the DOM as markup — the only tags in the output are the
 * ones this file constructs itself. Exactly one attribute VALUE in the output
 * comes from the author, a link's `href`, and what makes it safe is stated
 * where it is built: the regex admits nothing but an `http(s)://` URL, and
 * escaping has already turned every `"` into `&quot;`.
 *
 * Both callers hand this function text they do not control:
 *  - agent chat replies (a token name inside an LLM answer), and
 *  - CIP-108 governance metadata, which is off-chain JSON authored by whoever
 *    submitted the proposal. Anyone can submit a governance action.
 *
 * Supported: headings (# .. ######), bold (**), inline code (`), bullet and
 * numbered lists including nesting, blockquotes (>), horizontal rules, pipe
 * tables, links ([text](http(s)://...)), paragraphs with line breaks, and
 * optional `[n]` reference markers the caller opts into.
 *
 * Deliberately NOT supported:
 *  - italics: single-underscore/asterisk false-positives on token names and
 *    pool ids.
 *  - images: a remote `<img>` in wallet chrome is a tracking pixel and a CSP
 *    question, so `![alt](url)` degrades to its literal text — the whole
 *    `![alt](url)` string, visible and escaped. It is lifted out BEFORE the
 *    link rule runs so it cannot fall through into an anchor: silently turning
 *    an embed into an outbound link would manufacture a destination the author
 *    never wrote as one, and would leave a stray "!" in front of it. Literal
 *    text shows the reader exactly what the proposal actually says. A linked
 *    banner, `[![alt](img)](href)`, follows from the same two rules rather
 *    than being a case of its own: the anchor the author DID write survives,
 *    and its visible text is that literal image markdown.
 *  - raw HTML passthrough: that is the whole point of escaping first.
 */

/**
 * Attribute an inline `[n]` marker carries its 1-based index in.
 *
 * The marker is a real `<button>`, not a link. A bare `#fragment` href is not
 * a same-document jump in this app: the extension runs a HASH-MODE router, so
 * clicking one REPLACES the route and reloading that address lands on the
 * wallet home instead of the proposal. The value is written from the digits the
 * regex matched (`\d{1,3}`), so it is always a plain number and never author
 * text.
 *
 * That is this attribute's guarantee, not a blanket one, and the difference
 * matters to whoever edits next. The renderer DOES emit one attribute whose
 * value came from the author: a link's `href`. It is safe for two specific
 * reasons, and only while both hold — the link regex admits nothing but an
 * `http(s)://` URL, so no `javascript:` or `data:` value can reach it, and
 * escaping ran first, so every `"` inside it is already `&quot;` and the value
 * cannot close its own quote. Every other attribute in the output is a
 * constant this file writes.
 */
export const REFERENCE_MARKER_ATTR = 'data-md-ref';

/**
 * The 1-based reference index behind a click inside rendered prose, or null.
 *
 * Pair this with ONE delegated listener on the container that holds the
 * `v-html`. The renderer must never emit an inline `onclick`: an inline handler
 * is an execution sink sitting in output whose only defence is that escaping
 * ran first, and the marker needs no such attribute to work.
 */
export function referenceMarkerIndex(target: EventTarget | null): number | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return null;
  const marker = el.closest(`[${REFERENCE_MARKER_ATTR}]`);
  if (!marker) return null;
  const index = Number(marker.getAttribute(REFERENCE_MARKER_ATTR));
  return Number.isInteger(index) && index > 0 ? index : null;
}

/** Caller-supplied hooks. Everything here is optional; absent means "render literally". */
export interface RenderMarkdownOptions {
  /**
   * Whether an inline `[n]` marker (1-based) has a reference to jump to.
   * Return false to leave the marker as plain text — a marker with no matching
   * reference must never be given an invented target, and must not look
   * clickable either.
   */
  hasReference?: (index: number) => boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Bracket-tolerant inline text: anything but a bracket, or one whole `[...]`
 * group. Link text and image alt both use it, and they must keep using the
 * SAME one.
 *
 * A citation inside link text, `[see note [2] here](https://…)`, is the shape
 * this exists for: a text pattern that cannot cross the inner `]` matches
 * nothing at all — the anchor is lost and, worse, the `[2]` left behind in the
 * wreckage becomes a marker button embedded in literal text. One level of
 * nesting covers that, and it keeps the pattern unambiguous (the two branches
 * differ on their first character, so there is nothing to backtrack over).
 * Deeper nesting is not claimed: `[a [b [c] d] e](url)` stays literal text,
 * which is the same outcome it had before.
 *
 * The alt shares it so that the image rule stays a SUPERSET of the link rule:
 * whatever `[…](…)` shape the link rule could match, the image rule matches
 * the `![…](…)` spelling of it first and lifts it out. That is what keeps
 * `![a[1]b](url)` literal instead of an anchor with a stray "!" in front.
 */
const INLINE_TEXT = /(?:[^[\]]|\[[^[\]]*\])/.source;
const IMAGE = new RegExp(`!\\[${INLINE_TEXT}*\\]\\([^\\s)]*\\)`, 'g');
const LINK = new RegExp(`\\[(${INLINE_TEXT}+)\\]\\((https?:\\/\\/[^\\s)]+)\\)`, 'g');

/** Placeholder shape. Angle-bracketed on purpose — see `renderInline`. */
const SLOT = 'md-slot-';

/** Park finished HTML in `slots` and hand back the token that stands for it. */
function lift(slots: string[], html: string): string {
  slots.push(html);
  return `<${SLOT}${slots.length - 1}>`;
}

/**
 * Put every lifted fragment back, leaving no token behind for ANY nesting.
 *
 * Highest slot first. A slot's contents were built from the string as it stood
 * when that slot was created, so it can only ever mention slots that already
 * existed — strictly lower-numbered ones. Walking down therefore reveals only
 * tokens the loop has not reached yet, and the result is placeholder-free by
 * construction rather than by the caller having guessed the nesting right.
 *
 * `split`/`join` rather than `String.replace`: a stored fragment is part
 * author text, and `$&` or `$'` inside a replacement STRING would be expanded
 * as a substitution pattern.
 */
function restoreSlots(s: string, slots: string[]): string {
  let out = s;
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const token = `<${SLOT}${i}>`;
    if (out.includes(token)) out = out.split(token).join(slots[i]);
  }
  return out;
}

/**
 * Inline formatting on already-escaped text.
 *
 * Everything that has finished rendering is LIFTED OUT into a numbered slot
 * before the next rule runs, so no later rule can reach inside it. The
 * placeholder is spelled with angle brackets on purpose: escaping has already
 * turned every `<` in the author's text into `&lt;`, so a proposal that types
 * `<md-slot-0>` arrives here as `&lt;md-slot-0&gt;` and stays visible text —
 * it cannot forge a token and collect somebody else's rendered fragment.
 *
 * The order matters and is load-bearing:
 *  1. code spans — nothing formats inside `like this`.
 *  2. bold.
 *  3. images — lifted BEFORE links so `![alt](url)` cannot fall through into
 *     the link rule and come out as an anchor with a stray "!" in front.
 *  4. links — lifted BEFORE the `[n]` pass, which is the bug this ordering
 *     exists for: a URL may legitimately contain `[12]`, and running the
 *     marker rule over a finished `<a href="…[12]…">` splices a control into
 *     the middle of its own href, breaking the link AND leaking raw markup.
 *     It is also why a `[2]` inside LINK TEXT stays plain text: the anchor is
 *     already in a slot by then, so a marker button is never nested inside an
 *     anchor, which would be a control inside a control.
 *  5. `[n]` markers, over what is left: plain text only.
 *
 * Restore is `restoreSlots`, outermost-first. The old inner-last order assumed
 * a slot could never contain another slot, which `[![alt](img)](href)` — a
 * linked banner, ordinary in CIP-108 bodies — disproves: the image slot ends
 * up INSIDE the link slot, so restoring images first found nothing to do and
 * the raw token reached the DOM.
 */
function renderInline(escaped: string, options: RenderMarkdownOptions): string {
  const slots: string[] = [];

  let s = escaped.replace(/`([^`]+)`/g, (_m, code) => lift(slots, `<code>${code}</code>`));

  // bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // images stay literal — see the module header for why. Held verbatim so the
  // link rule below never sees them.
  s = s.replace(IMAGE, match => lift(slots, match));

  // links [text](http(s)://url) only - any other scheme is left as literal text.
  // `url` is the one author-derived attribute value this renderer emits: the
  // pattern restricts the scheme, and escaping already turned every `"` in it
  // into `&quot;`, so it cannot close the quote it sits in.
  s = s.replace(LINK, (_m, text, url) =>
    lift(slots, `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`),
  );

  // [n] reference markers, only where the caller says a reference exists.
  const has = options.hasReference;
  if (has) {
    s = s.replace(/\[(\d{1,3})\]/g, (marker, digits) => {
      const index = Number(digits);
      if (!has(index)) return marker;
      // A button, not an anchor: see REFERENCE_MARKER_ATTR. The only attribute
      // value that varies is `index`, which came from `\d{1,3}`.
      return `<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="${index}">${marker}</button>`;
    });
  }

  return restoreSlots(s, slots);
}

interface ListItemLine {
  indent: number;
  ordered: boolean;
  text: string;
}

const BULLET = /^(\s*)[-*]\s+(.*)$/;
const ORDERED = /^(\s*)\d+\.\s+(.*)$/;

function listAt(line: string | undefined): ListItemLine | null {
  if (line === undefined) return null;
  const bullet = BULLET.exec(line);
  if (bullet) return { indent: bullet[1].length, ordered: false, text: bullet[2] };
  const ordered = ORDERED.exec(line);
  if (ordered) return { indent: ordered[1].length, ordered: true, text: ordered[2] };
  return null;
}

/**
 * A list and everything nested under it. Deeper-indented items attach to the
 * item above them, so `<ul><li>a<ul><li>b</li></ul></li></ul>` comes out of the
 * indentation rather than being flattened into one level.
 */
function renderList(
  lines: string[],
  start: number,
  options: RenderMarkdownOptions,
): { html: string; next: number } {
  const first = listAt(lines[start]) as ListItemLine;
  const tag = first.ordered ? 'ol' : 'ul';
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    const item = listAt(lines[i]);
    if (!item || item.indent < first.indent) break;
    if (item.indent > first.indent) {
      if (!items.length) break;
      const nested = renderList(lines, i, options);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }
    if (item.ordered !== first.ordered) break;
    items.push(renderInline(item.text, options));
    i += 1;
  }

  return { html: `<${tag}>${items.map(html => `<li>${html}</li>`).join('')}</${tag}>`, next: i };
}

/** `|---|:--:|` and friends — the row that turns the line above it into a header. */
function isTableSeparator(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => cell.trim());
}

/**
 * A pipe table. Governance bodies are full of them (budget breakdowns), and
 * they are wide, so the table ships inside its own scroll box — the page body
 * must never scroll sideways because a proposal had eight columns.
 */
function renderTable(
  lines: string[],
  start: number,
  options: RenderMarkdownOptions,
): { html: string; next: number } {
  const header = splitRow(lines[start]);
  let i = start + 2;
  const body: string[][] = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    body.push(splitRow(lines[i]));
    i += 1;
  }

  const head = `<tr>${header.map(cell => `<th>${renderInline(cell, options)}</th>`).join('')}</tr>`;
  const rows = body
    .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, options)}</td>`).join('')}</tr>`)
    .join('');

  return {
    html: `<div class="md-table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`,
    next: i,
  };
}

/** Block-level pass over already-escaped lines. */
function renderBlocks(lines: string[], options: RenderMarkdownOptions): string {
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join('<br>'), options)}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      flushPara();
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      out.push('<hr>');
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const lvl = heading[1].length;
      out.push(`<div class="md-h md-h${lvl}">${renderInline(heading[2], options)}</div>`);
      i += 1;
      continue;
    }

    // `>` was escaped to `&gt;` by the time it gets here.
    if (/^&gt;\s?/.test(trimmed)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
        inner.push(lines[i].trim().replace(/^&gt;\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(inner, options)}</blockquote>`);
      continue;
    }

    if (trimmed.includes('|') && isTableSeparator(lines[i + 1])) {
      flushPara();
      const table = renderTable(lines, i, options);
      out.push(table.html);
      i = table.next;
      continue;
    }

    if (listAt(raw)) {
      flushPara();
      const list = renderList(lines, i, options);
      out.push(list.html);
      i = list.next;
      continue;
    }

    para.push(trimmed);
    i += 1;
  }

  flushPara();
  return out.join('');
}

/** Render a markdown document to a safe HTML string. */
export function renderMarkdown(src: string, options: RenderMarkdownOptions = {}): string {
  const normalized = (src || '').replace(/\r\n/g, '\n');
  return renderBlocks(escapeHtml(normalized).split('\n'), options);
}
