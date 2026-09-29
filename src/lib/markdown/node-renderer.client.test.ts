import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { createNodeMarkdownRenderer, renderNodeMarkdown } from './node-renderer';

const renderer = createNodeMarkdownRenderer(Marked, {}, {
  unresolvedTitle: 'Unresolved reference: no node at {target}',
});

describe('node Markdown rendering', () => {
  it('renders authored HTML with inline styles alongside Markdown', () => {
    const html = renderNodeMarkdown(
      renderer,
      'some text\n\n<div class="spec-core" style="border-radius: 1em 1em 0 0; padding: 1em; background-color: gray;"></div>\n\nsome other text',
    );
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.textContent).toContain('some text');
    expect(container.textContent).toContain('some other text');
    const spec = container.querySelector('.spec-core');
    expect(spec).not.toBeNull();
    expect(spec?.getAttribute('style')).toContain('background-color: gray');
  });

  it('sanitizes scripts, event handlers, and unsafe links before insertion', () => {
    const html = renderNodeMarkdown(
      renderer,
      '<script>alert(1)</script>\n\n<style>body { display: none }</style>\n\n<img src="x" onerror="alert(2)">\n\n[bad](javascript:alert%283%29)',
    );
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('keeps wikilink rendering in the node Markdown pipeline', () => {
    const withLink = createNodeMarkdownRenderer(
      Marked,
      { target: { href: '/app/u/hrn:node:hadronmemory.com:dev:target', label: 'Target' } },
      { unresolvedTitle: 'Unresolved reference: no node at {target}' },
    );
    const html = renderNodeMarkdown(withLink, 'See [[target]].');
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('a.wikilink')?.textContent).toBe('Target');
  });
});
