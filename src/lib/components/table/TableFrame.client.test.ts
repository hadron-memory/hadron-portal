/** #1021 — one shared table header: folded by default, attached to the table when open. */
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync, tick } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import TableFrame from './TableFrame.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const controls = createRawSnippet(() => ({ render: () => '<input data-testid="search" type="text" />' }));
const children = createRawSnippet(() => ({
  render: () => '<div data-testid="scroller" class="rounded-lg border"><table></table></div>',
}));

function mountFrame(extra: Record<string, unknown> = {}) {
  const m = mountComponent(TableFrame as never, { controls, children, ...extra } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  const q = (id: string) => m.target.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return { ...m, q };
}

describe('TableFrame (#1021)', () => {
  it('is folded by default: one toggle control, the header panel hidden', () => {
    const { q } = mountFrame();
    expect(q('table-header-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(q('table-header').hidden || q('table-header').className.includes('hidden')).toBe(true);
    expect(q('table-header').className).not.toMatch(/(^|\s)flex(\s|$)/);
  });

  it('keeps the controls MOUNTED while folded (ViewTabs applies the default view from onMount)', () => {
    const { q } = mountFrame();
    expect(q('search')).not.toBeNull();
    expect(q('table-header').contains(q('search'))).toBe(true);
  });

  it('unfolds on the toggle and refolds on Hide; aria-controls names the panel', () => {
    const { q } = mountFrame();
    const toggle = q('table-header-toggle');
    expect(toggle.getAttribute('aria-controls')).toBe(q('table-header').id);
    toggle.click();
    flushSync();
    expect(q('table-header').hidden).toBe(false);
    expect(q('table-header').className).toMatch(/(^|\s)flex(\s|$)/);
    q('table-header-hide').click();
    flushSync();
    expect(q('table-header').hidden).toBe(true);
    expect(q('table-header').className).not.toMatch(/(^|\s)flex(\s|$)/);
  });

  it('attaches to the table when open: shared border, squared table corners; not when folded', () => {
    const { q, target } = mountFrame();
    const wrapper = q('scroller').parentElement!;
    expect(wrapper.className).not.toMatch(/rounded-t-none/);
    q('table-header-toggle').click();
    flushSync();
    expect(q('table-header').className).toMatch(/\brounded-t-lg\b/);
    expect(q('table-header').className).toMatch(/\bborder-b-0\b/);
    expect(wrapper.className).toMatch(/rounded-t-none/);
    // The panel sits directly above the table wrapper: no spacing node between.
    expect(q('table-header').nextElementSibling).toBe(wrapper);
    expect(target.querySelectorAll('[data-testid="table-header"]')).toHaveLength(1);
  });

  it('moves focus with the controls: into the panel on open, back to the toggle on Hide', async () => {
    const { q, target } = mountFrame();
    document.body.appendChild(target); // focus() needs an attached tree
    q('table-header-toggle').click();
    await tick();
    await tick();
    expect(document.activeElement).toBe(q('search'));
    q('table-header-hide').click();
    await tick();
    await tick();
    expect(document.activeElement).toBe(q('table-header-toggle'));
  });

  it('wraps at narrow widths and keeps a stable panel id', () => {
    const { q } = mountFrame();
    expect(q('table-header').className).toMatch(/\bflex-wrap\b/);
    expect(q('table-header').firstElementChild!.className).toMatch(/\bflex-wrap\b/);
    expect(q('table-header').id).toMatch(/^table-frame-/);
    expect(q('table-header').id).not.toMatch(/0\.\d/);
  });

  it('flags a folded header that is still narrowing the rows', () => {
    expect(mountFrame({ active: true }).q('table-header-active')).not.toBeNull();
    expect(mountFrame({ active: false }).target.querySelector('[data-testid="table-header-active"]')).toBeNull();
  });
});
