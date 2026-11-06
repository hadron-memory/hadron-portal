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
  it('keeps https, mailto, fragment and portal-relative links', () => {
    const host = render('[a](https://x.test/p) [b](mailto:a@x.test) [c](#fx-1-a) [d](/app/u/hrn:node:o:m:l)');
    expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://x.test/p', 'mailto:a@x.test', '#fx-1-a', '/app/u/hrn:node:o:m:l']);
  });
  it('strips scripts, handlers and style elements as the node path does', () => {
    const host = render('<script>alert(1)</script>\n\n<style>body{display:none}</style>\n\n<img src="x" onerror="alert(2)">');
    expect(host.querySelector('script,style')).toBeNull();
    expect(host.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  });
  it('keeps heading levels, and a plain text link target stays text', () => {
    const host = render('# T\n\n## U\n\n### V\n\nplain target and [x](#fx-1-a)');
    expect([...host.querySelectorAll('h1,h2,h3')].map((h) => h.tagName)).toEqual(['H1', 'H2', 'H3']);
  });
  it('does not regroup or sort the server order', () => {
    const host = render('<a id="fx-3-a"></a>\n\n## Z\n\n<a id="fx-1-a"></a>\n\n## A\n\n<a id="fx-2-a"></a>\n\n## M');
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Z', 'A', 'M']);
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
