/**
 * Safe markdown -> HTML, injected via `v-html`.
 *
 * SAFETY MODEL (do not change the order): ALL input is HTML-escaped FIRST, then
 * a small markdown subset is rendered on the escaped text. Nothing an author
 * wrote can ever reach the DOM as markup — the only tags in the output are the
 * ones this file constructs itself.
 *
 * Both callers hand this function text they do not control:
 *  - agent chat replies (a token name inside an LLM answer), and
 *  - CIP-108 governance metadata, which is off-chain JSON authored by whoever
 *    submitted the proposal. Anyone can submit a governance action.
 *
 * Supported: headings (# .. ######), bold (**), inline code (`), bullet and
 * numbered lists including nesting, blockquotes (>), horizontal rules, pipe
 * tables, links ([text](http(s)://...)), paragraphs with line breaks, and
 * optional `[n]` reference markers resolved by the caller.
 *
 * Deliberately NOT supported:
 *  - italics: single-underscore/asterisk false-positives on token names and
 *    pool ids.
 *  - images: a remote `<img>` in wallet chrome is a tracking pixel and a CSP
 *    question. `![alt](url)` degrades to its literal text.
 *  - raw HTML passthrough: that is the whole point of escaping first.
 */

/** Caller-supplied hooks. Everything here is optional; absent means "render literally". */
export interface RenderMarkdownOptions {
  /**
   * Resolve an inline `[n]` marker (1-based) to a destination. Return undefined
   * to leave the marker as plain text — a marker with no matching reference
   * must never be given an invented target.
   */
  referenceHref?: (index: number) => string | undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline formatting on already-escaped text.
 *
 * Code spans are lifted out into placeholders before anything else runs, so no
 * later rule (bold, links, reference markers) can reach inside them. The
 * placeholder is spelled with angle brackets on purpose: escaping has already
 * turned every `<` in the author's text into `&lt;`, so author text cannot
 * forge one.
 */
function renderInline(escaped: string, options: RenderMarkdownOptions): string {
  const codes: string[] = [];
  let s = escaped.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(`<code>${code}</code>`);
    return `<md-code-${codes.length - 1}>`;
  });

  // bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // links [text](http(s)://url) only - any other scheme is left as literal text
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  // [n] reference markers, only where the caller says a reference exists.
  const resolve = options.referenceHref;
  if (resolve) {
    s = s.replace(/\[(\d{1,3})\]/g, (marker, digits) => {
      const href = resolve(Number(digits));
      if (!href) return marker;
      return `<a class="md-ref" href="${escapeHtml(href)}">${marker}</a>`;
    });
  }

  return s.replace(/<md-code-(\d+)>/g, (_m, i) => codes[Number(i)] ?? '');
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
