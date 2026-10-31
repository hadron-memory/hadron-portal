/**
 * #1493 CHECKED P: `[[hrn:node:…|label]]` renders as a followable link on the
 * chat / comment / briefing surfaces, through the real render + DOMPurify path.
 */
import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import { renderChatMarkdown } from './chat-markdown';

const URN = 'hrn:node:hadronmemory.com:hadron-dev-team-shared:chats:team:messages:8190-788d5a09-vera';
const render = (src: string) => DOMPurify.sanitize(renderChatMarkdown(src));

describe('renderChatMarkdown (#1493)', () => {
  it('renders [[urn|label]] as a resolver-route link with the label as text', () => {
    const html = render(`see [[${URN}|team chat #8190]] for context`);
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
    expect(a.textContent).toBe('team chat #8190');
    expect(a.getAttribute('href')).toBe(`/app/u/${URN}`);
  });

  it('falls back to the URN as link text when there is no label', () => {
    const html = render(`[[${URN}]]`);
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
    expect(a.textContent).toBe(URN);
    expect(a.getAttribute('href')).toBe(`/app/u/${URN}`);
  });

  it('also accepts the v1 :: form', () => {
    const v1 = 'hrn:node:hadronmemory.com::hadron-portal::findings:x';
    const a = new DOMParser().parseFromString(render(`[[${v1}|f]]`), 'text/html').querySelector('a')!;
    expect(a.getAttribute('href')).toMatch(/^\/app\/u\/hrn:node:/);
    expect(a.textContent).toBe('f');
  });

  it('leaves a bare [[loc]] as plain text', () => {
    const html = render('see [[some:loc]] and [[other|label]]');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('wikilink');
    expect(html).toContain('[[some:loc]]');
    expect(html).toContain('[[other|label]]');
  });

  it.each([
    ['unprefixed v1', '[[acme.com::memory::note|label]]'],
    ['unprefixed v2', '[[acme.com:memory:note|label]]'],
    ['unprefixed v1 no label', '[[acme.com::memory::note]]'],
  ])('leaves an %s target as text (only hrn:node: is claimed)', (_n, src) => {
    const html = render(`see ${src}`);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('wikilink');
    expect(html).toContain(src);
  });

  it('never lets a label inject HTML or a javascript: href', () => {
    const html = render(`[[${URN}|<img src=x onerror=alert(1)>]]`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // The label is escaped to inert text: no element, no handler attribute.
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('[onerror]')).toBeNull();
    const a = doc.querySelector('a')!;
    expect(a.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(a.getAttribute('href')).toBe(`/app/u/${URN}`);

    const js = render('[[javascript:alert(1)|x]] [x](javascript:alert(1))');
    expect(js).not.toMatch(/href="javascript:/i);
  });

  it('builds the href from the target, never from the label', () => {
    const a = new DOMParser()
      .parseFromString(render(`[[${URN}|/evil|https://evil.example]]`), 'text/html')
      .querySelector('a');
    // A label containing | is still a label; the href stays the resolver route.
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe(`/app/u/${URN}`);
    expect(a!.textContent).toBe('/evil|https://evil.example');
  });

  it('keeps ordinary markdown and leaves code spans verbatim', () => {
    const html = render(`**bold** \`[[${URN}|x]]\``);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain(`<code>[[${URN}|x]]</code>`);
  });
});
