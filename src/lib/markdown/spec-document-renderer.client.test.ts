import { afterEach, describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { createNodeMarkdownRenderer, renderNodeMarkdown } from './node-renderer';
import { renderSpecDocument, SPEC_ANCHOR_ID } from './spec-document-renderer';

function render(md: string, container: Element | null = null): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderSpecDocument(md, container ?? host);
  return host;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('spec document anchors', () => {
  it('keeps the server anchors, uppercase, dotted and suffixed', () => {
    const host = render('<a id="fx-110-01"></a>\n\n## Definition\n\n<a id="Fx-110-B"></a>\n\n<a id="fx-1.2-a-2"></a>\n\n<a id="fx-110-01-3"></a>\n');
    expect([...host.querySelectorAll('a[id]')].map((a) => a.id)).toEqual(['fx-110-01', 'Fx-110-B', 'fx-1.2-a-2', 'fx-110-01-3']);
  });
  it('an in-document link keeps its fragment href and the anchor exists to take it', () => {
    const host = render('<a id="fx-110-01"></a>\n\n## A\n\nsee [a](#fx-110-01)');
    expect(host.querySelector('a[href="#fx-110-01"]')).not.toBeNull();
    expect(host.querySelector('#fx-110-01')).not.toBeNull();
  });
  it.each(['window', 'constructor', '__proto__', 'x', 'document', 'toString', '-a', 'a b', ''])('strips a hyphenless or malformed id %j', (id) => {
    const host = render(`<a id="${id}"></a>`);
    expect(host.querySelector('[id]')).toBeNull();
  });
  it('does not match a hyphenless name (pattern pin)', () => {
    expect(SPEC_ANCHOR_ID.test('window')).toBe(false);
    expect(SPEC_ANCHOR_ID.test('fx-110-01')).toBe(true);
  });
  it('strips an id on anything but an empty bare anchor', () => {
    const host = render('<div id="a-b">x</div>\n\n<a id="c-d" href="https://x.test">t</a>\n\n<a id="e-f">child</a>\n\n<a id="g-h" class="k"></a>\n\n<span id="i-j"></span>\n\n<h2 id="k-l">h</h2>');
    expect(host.querySelector('[id]')).toBeNull();
  });
  // F1 (#2271): ruling 0206 and hrn:node:hadronmemory.com:specs:cor:spc:030:02: the server's assigned anchors are unique across the document and its anchor
  // line sits directly before the part's heading; an authored copy of the same id in a body
  // must never be the one that survives when it comes first.
  it('an authored anchor that precedes the server anchor of the same id cannot take its id', () => {
    const host = render('<a id="fx-1-a"></a>\n\nauthored text\n\n<a id="fx-1-a"></a>\n\n## Part A\n\nsee [a](#fx-1-a)');
    const kept = [...host.querySelectorAll('a[id="fx-1-a"]')];
    expect(kept).toHaveLength(1);
    expect(kept[0].parentElement?.nextElementSibling?.tagName).toBe('H3');
    expect(kept[0].parentElement?.nextElementSibling?.textContent).toBe('Part A');
  });
  // F1 known limit (Gemma BLIND P2-1): an authored copy that mimics the server's
  // anchor-block-then-heading shape and comes first cannot be told from the server's
  // by the rendered HTML. Pinned so the limit is a stated fact, not a surprise; closing
  // it is a server change (neutralise authored ids that match the anchor shape).
  it('KNOWN LIMIT: an authored copy that mimics the anchor-then-heading shape and comes first keeps the id', () => {
    const host = render('<a id="fx-1-a"></a>\n\n## Authored\n\n<a id="fx-1-a"></a>\n\n## Part A');
    const kept = [...host.querySelectorAll('a[id="fx-1-a"]')];
    expect(kept).toHaveLength(1);
    expect(kept[0].parentElement?.nextElementSibling?.textContent).toBe('Authored');
  });
  it('an authored anchor after the server anchor of the same id is the one dropped', () => {
    const host = render('<a id="fx-1-a"></a>\n\n## Part A\n\n<a id="fx-1-a"></a>\n\nauthored');
    const kept = [...host.querySelectorAll('a[id="fx-1-a"]')];
    expect(kept).toHaveLength(1);
    expect(kept[0].parentElement?.nextElementSibling?.tagName).toBe('H3');
  });
  it('the anchor allowlist is exactly the 0206 shape the portal already enforced (neither widened nor narrowed here)', () => {
    expect(SPEC_ANCHOR_ID.source).toBe('^[A-Za-z0-9][A-Za-z0-9._]*(?:-[A-Za-z0-9._]*)+$');
  });
  it('keeps only the first of a duplicated anchor', () => {
    const host = render('<a id="fx-1-a"></a>\n\n<a id="fx-1-a"></a>');
    expect(host.querySelectorAll('[id]').length).toBe(1);
  });
  it('drops an id that already names a live element outside the view (portal chrome)', () => {
    const chrome = document.createElement('nav');
    chrome.id = 'main-nav';
    document.body.append(chrome);
    const view = document.createElement('div');
    document.body.append(view);
    view.innerHTML = renderSpecDocument('<a id="main-nav"></a>\n\n<a id="fx-1-a"></a>', view);
    expect(view.querySelector('#fx-1-a')).not.toBeNull();
    expect(view.querySelector('a[id="main-nav"]')).toBeNull();
    expect(document.getElementById('main-nav')).toBe(chrome);
  });
  it('an id already inside the view container is not a clash (re-render)', () => {
    const view = document.createElement('div');
    document.body.append(view);
    view.innerHTML = renderSpecDocument('<a id="fx-1-a"></a>', view);
    view.innerHTML = renderSpecDocument('<a id="fx-1-a"></a>', view);
    expect(view.querySelector('#fx-1-a')).not.toBeNull();
  });
  it('drops data-* and aria-* attributes', () => {
    const host = render('<a id="fx-1-a" data-x="1" aria-label="l"></a>\n\n<div data-y="1" aria-hidden="true">t</div>');
    expect(host.querySelector('[data-x],[aria-label],[data-y],[aria-hidden]')).toBeNull();
    expect(host.querySelector('#fx-1-a')).not.toBeNull();
  });
});

describe('spec document links and markup safety', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'blob:https://x/1', 'data:text/html,x', '//evil.test/x', 'vbscript:x'])('removes the href of %s', (u) => {
    const host = render(`[x](${u})`);
    expect(host.querySelector('a')?.hasAttribute('href') ?? false).toBe(false);
  });
  it('removes a raw-HTML href of /\\host: browsers read the backslash as a slash (protocol-relative)', () => {
    const host = render('<a href="/\\evil.test/x">x</a>');
    expect(host.querySelector('a')?.hasAttribute('href') ?? false).toBe(false);
  });
  it('keeps https, mailto, fragment and portal-relative links', () => {
    const host = render('[a](https://x.test/p) [b](mailto:a@x.test) [c](#fx-1-a) [d](/app/u/hrn:node:o:m:l)');
    expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://x.test/p', 'mailto:a@x.test', '#fx-1-a', '/app/u/hrn:node:o:m:l']);
  });
  // F2 (#2271): the three link forms hrn:node:hadronmemory.com:specs:cor:spc:030:02 fixes for the server's output, pinned one by one.
  it('form 1, a jump to a part, stays a fragment link', () => {
    const host = render('<a id="fx-1-a"></a>\n\n## A\n\n[go](#fx-1-a)');
    expect(host.querySelector('a[href="#fx-1-a"]')?.textContent).toBe('go');
  });
  it('form 2, a wikilink outside the document, stays an absolute portal link', () => {
    const host = render('[Name](https://portal.example:5173/app/u/hrn:node:o.test:m:cor:agt:110)');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://portal.example:5173/app/u/hrn:node:o.test:m:cor:agt:110');
  });
  it('form 3, plain text for an unreadable or missing target, stays text', () => {
    const host = render('see Unreadable Target and also Missing One here');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('Unreadable Target');
  });
  it.each(['sibling/page', 'hrn:node:o.test:m:cor:agt:110', 'urn:x'])('an authored scheme-less or raw-URN href %j renders as dead text, the portal\'s call', (u) => {
    const host = render(`[x](${u})`);
    const dead = host.querySelector('a');
    expect(dead).not.toBeNull();
    expect(dead?.hasAttribute('href')).toBe(false);
    expect(host.textContent).toContain('x');
  });
  it('strips scripts, handlers and style elements as the node path does', () => {
    const host = render('<script>alert(1)</script>\n\n<style>body{display:none}</style>\n\n<img src="x" onerror="alert(2)">');
    expect(host.querySelector('script,style')).toBeNull();
    expect(host.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  });
  it('shifts every heading one level down, so the page title stays the only h1 and relative levels hold', () => {
    const host = render('# T\n\n## U\n\n### V\n\n###### W\n\nplain target and [x](#fx-1-a)');
    expect([...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName)).toEqual(['H2', 'H3', 'H4', 'H6']);
    expect(host.querySelector('h1')).toBeNull();
  });
  it('an authored h5 and h6 both end as h6: h6 has nowhere to go, every other level shifts by one', () => {
    const host = render('##### five\n\n###### six');
    expect([...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName)).toEqual(['H6', 'H6']);
  });
  it('does not regroup or sort the server order', () => {
    const host = render('<a id="fx-3-a"></a>\n\n## Z\n\n<a id="fx-1-a"></a>\n\n## A\n\n<a id="fx-2-a"></a>\n\n## M');
    expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Z', 'A', 'M']);
    expect([...host.querySelectorAll('a[id]')].map((a) => a.id)).toEqual(['fx-3-a', 'fx-1-a', 'fx-2-a']);
  });
});

describe('the shared node path is unchanged', () => {
  it('still strips id everywhere on a node page', () => {
    const renderer = createNodeMarkdownRenderer(Marked, {}, { unresolvedTitle: 'x {target}' });
    const host = document.createElement('div');
    host.innerHTML = renderNodeMarkdown(renderer, '<a id="fx-110-01"></a>\n\n<div id="a-b">x</div>');
    expect(host.querySelector('[id]')).toBeNull();
  });
  it('rendering a spec document does not loosen a later node render', () => {
    render('<a id="fx-110-01"></a>');
    const renderer = createNodeMarkdownRenderer(Marked, {}, { unresolvedTitle: 'x {target}' });
    const host = document.createElement('div');
    host.innerHTML = renderNodeMarkdown(renderer, '<a id="fx-110-01"></a>');
    expect(host.querySelector('[id]')).toBeNull();
  });
});
