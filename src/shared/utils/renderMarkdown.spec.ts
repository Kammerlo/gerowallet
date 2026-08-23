import { describe, it, expect } from 'vitest';
import { renderMarkdown, referenceMarkerIndex, REFERENCE_MARKER_ATTR } from './renderMarkdown';

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

  it('marks up a [n] marker only when the caller says that index exists', () => {
    const options = { hasReference: (n: number) => n <= 2 };
    const out = renderMarkdown('See [1] and [2] and [9].', options);
    expect(out).toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="1">[1]</button>`);
    expect(out).toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="2">[2]</button>`);
    // No reference at index 9, so no invented destination.
    expect(out).toContain('[9]');
    expect(out).not.toContain(`${REFERENCE_MARKER_ATTR}="9"`);
  });

  it('leaves every [n] marker literal when the caller resolves nothing', () => {
    expect(renderMarkdown('See [1].')).toBe('<p>See [1].</p>');
  });
});

// The wallet runs a HASH-MODE router. A `#gov-ref-2` href is not a
// same-document jump here: it overwrites the route in the address bar, and a
// reload of that address hits the catch-all and lands on the wallet home with
// the proposal gone. So the marker is a real button and the view scrolls.
describe('renderMarkdown, [n] markers are controls and not fragment links', () => {
  const options = { hasReference: () => true };

  it('never emits a fragment href, and never an inline handler', () => {
    const out = renderMarkdown('See [2].', options);
    expect(out).not.toContain('href');
    expect(out).not.toMatch(/\bon[a-z]+=/i);
    expect(out).toContain('<button type="button"');
  });

  it('emits a natively focusable control, so Enter and Space work without a key handler', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('See [2].', options);
    const marker = el.querySelector('button.md-ref') as HTMLButtonElement;
    expect(marker).toBeTruthy();
    expect(marker.type).toBe('button');
    expect(marker.textContent).toBe('[2]');
    // The bracket glyphs are the non-colour cue; the accessible name is the
    // marker itself, as a printed footnote reference reads.
    expect(marker.getAttribute(REFERENCE_MARKER_ATTR)).toBe('2');
  });

  it('resolves the index from any node inside the marker, and from nothing else', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('See [2] and plain text.', options);
    const marker = el.querySelector('button.md-ref') as HTMLElement;
    expect(referenceMarkerIndex(marker)).toBe(2);
    expect(referenceMarkerIndex(el)).toBeNull();
    expect(referenceMarkerIndex(null)).toBeNull();
  });
});

// Both of these are output corruption inside a renderer whose whole contract is
// that nothing an author wrote reaches the DOM as markup.
describe('renderMarkdown, inline pass ordering', () => {
  it('does not splice a marker into the href of a link whose URL contains [12]', () => {
    // Real shape: an archive permalink carrying a bracketed section number.
    const out = renderMarkdown('See [the note](https://example.test/doc[12].pdf) please.', {
      hasReference: () => true,
    });
    expect(out).toBe(
      '<p>See <a href="https://example.test/doc[12].pdf" target="_blank" rel="noopener noreferrer">' +
        'the note</a> please.</p>',
    );
    // The href must be intact: no control, and no raw template text, inside it.
    expect(out).not.toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="12">`);
  });

  it('still marks up a real [n] alongside such a link', () => {
    const out = renderMarkdown('[doc](https://example.test/a[3]b) and [3].', { hasReference: () => true });
    expect(out).toContain('href="https://example.test/a[3]b"');
    expect(out).toContain(`${REFERENCE_MARKER_ATTR}="3">[3]</button>`);
    // Exactly one control: the one outside the link.
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it('leaves a markdown image as literal text instead of an anchor with a stray "!"', () => {
    // A remote <img> in wallet chrome is a tracking pixel and a CSP question,
    // and silently turning an embed into an outbound link would manufacture a
    // destination the author never wrote as one.
    const out = renderMarkdown('![Budget chart](https://example.test/chart.png)');
    expect(out).toBe('<p>![Budget chart](https://example.test/chart.png)</p>');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<img');
  });

  it('keeps a plain link working next to an image', () => {
    const out = renderMarkdown('![alt](https://a.test/x.png) then [real](https://b.test/)');
    expect(out).toContain('![alt](https://a.test/x.png)');
    expect(out).toContain('<a href="https://b.test/" target="_blank" rel="noopener noreferrer">real</a>');
  });
});

// The inline pass parks each finished fragment in a numbered slot so no later
// rule can reach inside it, and puts them all back at the end. A slot that is
// still parked when the string leaves is a raw token in the DOM, which is both
// a visible defect (the fragment it stood for is simply gone) and a claim the
// renderer's own contract makes: the only tags in the output are its own.
describe('renderMarkdown, no internal placeholder survives to the output', () => {
  it('renders a linked image as an anchor whose text is the literal image markdown', () => {
    // `[![alt](img)](href)` — a linked banner or logo, ordinary in CIP-108
    // bodies. Both rules apply as written: the image degrades to literal text,
    // and the anchor the author DID write survives with that text inside it.
    // No destination is invented, and no <img> is fetched.
    const out = renderMarkdown('[![Gero logo](https://img.test/logo.png)](https://gerowallet.io/)');
    expect(out).toBe(
      '<p><a href="https://gerowallet.io/" target="_blank" rel="noopener noreferrer">' +
        '![Gero logo](https://img.test/logo.png)</a></p>',
    );
    expect(out).not.toContain('<img');
    expect(out).not.toMatch(/md-slot-/);
  });

  it('restores every slot when they nest several deep', () => {
    // code inside bold inside link text, with an image beside it: the image
    // slot ends up INSIDE the link slot, which is the nesting the old
    // inner-last restore order assumed could not happen.
    const out = renderMarkdown('[**bold `code`** and ![img](https://i.test/x.png)](https://h.test/)');
    expect(out).toBe(
      '<p><a href="https://h.test/" target="_blank" rel="noopener noreferrer">' +
        '<strong>bold <code>code</code></strong> and ![img](https://i.test/x.png)</a></p>',
    );
  });

  it('leaves no token behind for any nesting of code, bold, image, link and [n]', () => {
    const shapes = [
      '[![alt](https://i.test/a.png)](https://h.test/)',
      '[read `pool1abc`](https://a.test/)',
      '**[bolded link](https://a.test/)**',
      '[**bold text**](https://a.test/)',
      '`[1] inside code`',
      '![alt with [2] inside](https://i.test/a.png)',
      '[link text with [2]](https://a.test/) and [2] outside',
      '| [![a](https://i.test/a.png)](https://h.test/) | `x` |\n| --- | --- |\n| [2] | ok |',
      '> [![a](https://i.test/a.png)](https://h.test/)',
      '#### [![a](https://i.test/a.png)](https://h.test/)',
      '- [![a](https://i.test/a.png)](https://h.test/)',
    ];
    for (const shape of shapes) {
      const out = renderMarkdown(shape, { hasReference: () => true });
      expect(out, shape).not.toMatch(/md-slot-/);
      // Nothing in the output may look like a token of any generation.
      expect(out, shape).not.toMatch(/<md-[a-z]+-\d+>/);
    }
  });

  it('cannot be handed a forged token by the author, whatever it is spelled like', () => {
    // The token is angle-bracketed precisely because escaping has already
    // removed every `<` the author wrote, so a proposal that types one gets it
    // back as visible text — it can neither collect a real fragment nor
    // disappear.
    const out = renderMarkdown('`real` then <md-slot-0> and <md-code-0>');
    expect(out).toBe('<p><code>real</code> then &lt;md-slot-0&gt; and &lt;md-code-0&gt;</p>');
  });

  it('keeps a forged token literal even as the text of a real link', () => {
    const out = renderMarkdown('[<md-slot-0>](https://a.test/) and `code`');
    expect(out).toBe(
      '<p><a href="https://a.test/" target="_blank" rel="noopener noreferrer">&lt;md-slot-0&gt;</a>' +
        ' and <code>code</code></p>',
    );
  });
});

// A reference marker inside LINK TEXT used to cost the anchor outright: the
// link pattern could not cross the inner `]`, so the line stayed literal text
// with a pressable button sitting in the middle of it.
describe('renderMarkdown, a [n] marker inside link text', () => {
  const options = { hasReference: () => true };

  it('keeps the anchor and leaves the marker as text inside it', () => {
    const out = renderMarkdown('See [see note [2] here](https://example.test) please.', options);
    expect(out).toBe(
      '<p>See <a href="https://example.test" target="_blank" rel="noopener noreferrer">' +
        'see note [2] here</a> please.</p>',
    );
  });

  it('never nests a control inside the anchor', () => {
    // Two interactive controls, one inside the other, is an accessibility
    // defect however the click handling is wired.
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[see note [2] here](https://example.test)', options);
    const anchor = el.querySelector('a') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe('see note [2] here');
    expect(el.querySelectorAll('a button, a a')).toHaveLength(0);
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('still marks up the same marker where it stands outside a link', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[see note [2] here](https://example.test) and [2].', options);
    expect(el.querySelectorAll('a')).toHaveLength(1);
    // Exactly one control, and it is not inside the anchor.
    expect(el.querySelectorAll('button.md-ref')).toHaveLength(1);
    expect(el.querySelectorAll('a button')).toHaveLength(0);
  });

  it('does not let a bracketed alt turn an image into an anchor with a stray "!"', () => {
    // The alt tolerates the same one level of brackets the link text does, so
    // the image rule still matches first and the whole thing stays literal.
    const out = renderMarkdown('![a[1]b](https://x.test/i.png)', options);
    expect(out).toBe('<p>![a[1]b](https://x.test/i.png)</p>');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<button');
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
