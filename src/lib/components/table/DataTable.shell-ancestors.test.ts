/**
 * portal#2367 — the real layouts must keep leaving page scrolling to the document.
 *
 * The Chromium script (scripts/test-data-table-fill-layout.mjs) proves scroll ownership for the
 * app shell's own classes, but it builds its wrapper from the shared constants; it cannot see a
 * wrapper added to the real layout. This pins the real layout markup: every element that encloses
 * the page outlet (`{@render children()}`) is named here, and none may scroll, clip or fix. A new
 * wrapper fails the chain check; a changed class fails the token check.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';
import appLayout from '../../../routes/app/+layout.svelte?raw';
import rootLayout from '../../../routes/+layout.svelte?raw';
import { APP_SHELL_ROW, APP_SHELL_CONTENT } from '$lib/layout/app-shell';

type Node = { type: string; name?: string; start: number; end: number; attributes?: Array<{ type: string; name: string; start: number; end: number }>; [k: string]: unknown };

/** The enclosing elements of the first `{@render children()}`, outermost first, as `name |attrs source|`. */
function outletAncestors(source: string): Array<{ name: string; cls: string; style: string }> {
  const root = parse(source, { modern: true }) as unknown as Node;
  const path: Node[] = [];
  let found = null as Node[] | null;
  const walk = (node: unknown) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const n = node as Node;
    if (n.type === 'RenderTag' && source.slice(n.start, n.end).includes('children()')) { found = [...path]; return; }
    const element = n.type === 'RegularElement';
    if (element) path.push(n);
    for (const [key, value] of Object.entries(n)) if (key !== 'parent' && key !== 'metadata') walk(value);
    if (element) path.pop();
  };
  walk((root as unknown as { fragment: unknown }).fragment);
  const attr = (n: Node, name: string) => {
    const a = n.attributes?.find((x) => x.type === 'Attribute' && x.name === name);
    return a ? source.slice(a.start, a.end) : '';
  };
  return (found ?? []).map((n) => ({ name: n.name ?? '', cls: attr(n, 'class'), style: attr(n, 'style') }));
}

const SCROLLS = /\boverflow(-[xy])?-(auto|scroll|hidden|clip)\b|(?<!min-)\b(max-)?h-(screen|dvh|svh|lvh)\b|\bfixed\b/;
const INLINE = /overflow(-[xy])?\s*:\s*(auto|scroll|hidden|clip)|height\s*:\s*(calc\()?100d?vh/;

describe('the real layouts leave page scrolling to the document (portal#2367)', () => {
  it('the app layout encloses the outlet in exactly the shell row and content, and nothing else', () => {
    const chain = outletAncestors(appLayout);
    expect(chain.map((c) => c.cls)).toEqual(['class={APP_SHELL_ROW}', 'class={APP_SHELL_CONTENT}']);
    expect(chain.map((c) => c.name)).toEqual(['div', 'div']);
    for (const c of chain) expect(c.style).toBe('');
    // The classes themselves are the shared constants the Chromium script mounts.
    for (const value of [APP_SHELL_ROW, APP_SHELL_CONTENT]) {
      expect(SCROLLS.test(value)).toBe(false);
    }
  });

  it('the root layout encloses the outlet in a plain div and main that cannot scroll, clip or fix', () => {
    const chain = outletAncestors(rootLayout);
    expect(chain.map((c) => c.name)).toEqual(['div', 'main']);
    for (const c of chain) {
      expect(SCROLLS.test(c.cls), c.cls).toBe(false);
      expect(INLINE.test(c.style), c.style).toBe(false);
    }
  });

  it('control: the check sees a scrolling wrapper', () => {
    const wrapped = '<div class="overflow-auto"><main>{@render children()}</main></div>';
    const chain = outletAncestors(wrapped);
    expect(chain.some((c) => SCROLLS.test(c.cls))).toBe(true);
  });
});
