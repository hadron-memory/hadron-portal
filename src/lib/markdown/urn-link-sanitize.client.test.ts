/**
 * #1053 CHECKED P: malformed `hrn:node:` markdown targets stay inert and safe,
 * and sanitization is unchanged — through the real render + DOMPurify path.
 */
import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { createNodeMarkdownRenderer, renderNodeMarkdown } from './node-renderer';

const strings = { unresolvedTitle: 'Unresolved reference: no node at {target}' };
const render = (src: string, links = {}) =>
  renderNodeMarkdown(createNodeMarkdownRenderer(Marked, links, strings), src);

describe('[label](hrn:node:…) through the sanitizer (#1053)', () => {
  it.each([
    ['too few atoms', '[x](hrn:node:a.com:m)'],
    ['empty target', '[x](hrn:node:)'],
    ['empty atom', '[x](hrn:node:a.com::loc)'],
  ])('%s never becomes a followable hrn: anchor', (_n, src) => {
    const html = render(src);
    expect(html).not.toMatch(/<a [^>]*href="hrn:/);
  });

  it('cannot break out of the attribute or inject a handler', () => {
    const html = render('[x](hrn:node:a.com:m:l"onmouseover="alert(1))');
    expect(html).not.toMatch(/onmouseover=/);
    expect(html).not.toContain('<script');
  });

  it('an unresolved URN link shows the target as text, escaped', () => {
    const html = render('[<b>x</b>](hrn:node:a.com:m:l)');
    expect(html).toContain('wikilink-unresolved');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('a resolved link keeps only the internal href it was given', () => {
    const urn = 'hrn:node:a.com:m:l';
    const html = render(`[x](${urn})`, { [urn]: { href: '/app/memories/m/nodes/n', label: 'N' } });
    expect(html).toContain('href="/app/memories/m/nodes/n"');
    expect(html).not.toMatch(/href="hrn:/);
  });

  it('leaves javascript: and ordinary links exactly as before', () => {
    expect(render('[x](javascript:alert(1))')).not.toMatch(/href="javascript:/i);
    expect(render('[x](https://example.com)')).toContain('href="https://example.com"');
  });
});
