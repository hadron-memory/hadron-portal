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
    const spec = container.querySelector('.node-html-spec-core');
    expect(spec).not.toBeNull();
    expect(spec?.getAttribute('style')).toContain('background-color: gray');
  });

  it('sanitizes scripts, event handlers, and unsafe links before insertion', () => {
    const html = renderNodeMarkdown(
      renderer,
      '<script>alert(1)</script>\n\n<style>body { display: none }</style>\n\n<div class="fixed inset-0 z-50 bg-white" style="position:fixed;inset:0;z-index:9999;background-color:white">cover</div>\n\n<img src="x" onerror="alert(2)">\n\n[bad](javascript:alert%283%29)',
    );
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('.fixed')).toBeNull();
    expect(container.querySelector('.node-html-fixed')?.getAttribute('style')).toBe('background-color: white;');
    expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('keeps authored forms inert while retaining disabled Markdown task checkboxes', () => {
    const html = renderNodeMarkdown(
      renderer,
      '<form method="POST" action="?/delete"><input type="image" name="hard" src="x"><button formaction="?/delete">Delete</button></form>\n\n<div id="portal-root">content</div>\n\n- [x] done',
    );
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('form, button, [action], [formaction], [name], [id]')).toBeNull();
    expect([...container.querySelectorAll('input')].every((input) => input.type === 'checkbox' && input.disabled)).toBe(true);
    expect(container.querySelector('input[checked]')).not.toBeNull();
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
