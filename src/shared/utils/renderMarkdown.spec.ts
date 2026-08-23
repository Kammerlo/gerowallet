import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

describe('renderMarkdown', () => {
  it('renders bold', () => {
    expect(renderMarkdown('**ADA:** 1,516')).toBe('<p><strong>ADA:</strong> 1,516</p>');
  });

  it('renders a bullet list', () => {
    expect(renderMarkdown('- GERO: 7,747\n- SNEK: 1,265')).toBe(
      '<ul><li>GERO: 7,747</li><li>SNEK: 1,265</li></ul>',
    );
  });

  it('renders a numbered list', () => {
    expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('pool `pool12vscr8i`')).toBe('<p>pool <code>pool12vscr8i</code></p>');
  });

  it('renders headings', () => {
    expect(renderMarkdown('## Tokens')).toBe('<div class="md-h md-h2">Tokens</div>');
  });

  it('renders an http(s) link but never javascript: urls', () => {
    expect(renderMarkdown('[Gero](https://gerowallet.io)')).toBe(
      '<p><a href="https://gerowallet.io" target="_blank" rel="noopener noreferrer">Gero</a></p>',
    );
    // non-http scheme is left as escaped literal text, never an anchor
    const evil = renderMarkdown('[x](javascript:alert(1))');
    expect(evil).not.toMatch(/<a /);
    expect(evil).toMatch(/javascript:alert/);
  });

  it('escapes HTML so injected markup cannot execute (XSS)', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)> and <script>bad()</script>');
    expect(out).not.toMatch(/<img/);
    expect(out).not.toMatch(/<script/);
    expect(out).toMatch(/&lt;img/);
    expect(out).toMatch(/&lt;script&gt;/);
  });

  it('keeps code content escaped', () => {
    expect(renderMarkdown('`<b>hi</b>`')).toBe('<p><code>&lt;b&gt;hi&lt;/b&gt;</code></p>');
  });

  it('separates paragraphs on a blank line and joins wrapped lines with <br>', () => {
    expect(renderMarkdown('line one\nline two\n\npara two')).toBe(
      '<p>line one<br>line two</p><p>para two</p>',
    );
  });
});

// CIP-108 proposal bodies are real documents, not captions. A census of the 12
// newest mainnet actions found tables in 7, h4+ in 4, nested lists in 3 and
// horizontal rules in 2 — every construct below is one a real proposal ships,
// and each was rendering as literal punctuation before.
describe('renderMarkdown, governance document constructs', () => {
  it('renders headings down to h6, not just h3', () => {
    expect(renderMarkdown('#### Alignment with G.1')).toBe(
      '<div class="md-h md-h4">Alignment with G.1</div>',
    );
    expect(renderMarkdown('###### Deep')).toBe('<div class="md-h md-h6">Deep</div>');
    // Seven hashes is not a heading in any dialect; it stays literal.
    expect(renderMarkdown('####### Nope')).toBe('<p>####### Nope</p>');
  });

  it('renders a horizontal rule', () => {
    expect(renderMarkdown('above\n\n---\n\nbelow')).toBe('<p>above</p><hr><p>below</p>');
    expect(renderMarkdown('***')).toBe('<hr>');
    expect(renderMarkdown('___')).toBe('<hr>');
  });

  it('renders a blockquote, whose marker survived HTML escaping as &gt;', () => {
    expect(renderMarkdown('> quoted claim')).toBe('<blockquote><p>quoted claim</p></blockquote>');
  });

  it('nests a list by indentation instead of flattening it', () => {
    expect(renderMarkdown('- outer\n  - inner\n- second')).toBe(
      '<ul><li>outer<ul><li>inner</li></ul></li><li>second</li></ul>',
    );
  });

  it('renders a pipe table inside its own scroll box', () => {
    const out = renderMarkdown('| Item | Ada |\n| --- | --- |\n| Audit | 120,000 |');
    expect(out).toBe(
      '<div class="md-table"><table>' +
        '<thead><tr><th>Item</th><th>Ada</th></tr></thead>' +
        '<tbody><tr><td>Audit</td><td>120,000</td></tr></tbody>' +
        '</table></div>',
    );
  });

  it('leaves a pipe line alone when no separator row follows it', () => {
    expect(renderMarkdown('a | b')).toBe('<p>a | b</p>');
  });

  it('links a [n] marker only when the caller resolves that index', () => {
    const options = { referenceHref: (n: number) => (n <= 2 ? `#gov-ref-${n}` : undefined) };
    const out = renderMarkdown('See [1] and [2] and [9].', options);
    expect(out).toContain('<a class="md-ref" href="#gov-ref-1">[1]</a>');
    expect(out).toContain('<a class="md-ref" href="#gov-ref-2">[2]</a>');
    // No reference at index 9, so no invented destination.
    expect(out).toContain('[9]');
    expect(out).not.toContain('gov-ref-9');
  });

  it('leaves every [n] marker literal when the caller resolves nothing', () => {
    expect(renderMarkdown('See [1].')).toBe('<p>See [1].</p>');
  });
});

// Governance metadata is authored by whoever submitted the action — anyone can
// submit one. These cases pin the escape-first contract for every construct the
// governance surface added, because a table cell or a quote must not become an
// injection vector the way a paragraph never was.
describe('renderMarkdown, untrusted-author safety', () => {
  it('renders an embedded script, an onerror attribute and a javascript: url inert', () => {
    const out = renderMarkdown(
      '<script>steal()</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))',
    );
    expect(out).not.toMatch(/<script/i);
    // No element carries the handler: `onerror=` may only survive as visible
    // text inside an escaped `&lt;img …&gt;`, never as a real attribute.
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<[a-z][^>]*onerror/i);
    expect(out).not.toMatch(/<a /);
    // Every one of them survives as visible, escaped text instead.
    expect(out).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('javascript:alert');
  });

  it('keeps table cells escaped', () => {
    const out = renderMarkdown('| a | b |\n| --- | --- |\n| <img src=x onerror=alert(1)> | ok |');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('<td>&lt;img src=x onerror=alert(1)&gt;</td>');
  });

  it('keeps blockquote and heading content escaped', () => {
    expect(renderMarkdown('> <script>x</script>')).toContain('&lt;script&gt;');
    expect(renderMarkdown('#### <script>x</script>')).toContain('&lt;script&gt;');
  });

  it('cannot be tricked into forging a code-span placeholder', () => {
    // The placeholder is spelled with angle brackets precisely because escaping
    // has already removed every `<` the author wrote.
    const out = renderMarkdown('<md-code-0> and `real`');
    expect(out).toContain('&lt;md-code-0&gt;');
    expect(out).toContain('<code>real</code>');
  });
});
