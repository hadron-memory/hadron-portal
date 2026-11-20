/**
 * portal#2193 (ruling 0276) — a full-page DataTable fills the window below its own top edge, with
 * no per-page offset. jsdom does not lay out, so the geometry is stood in for: the scroller's top
 * is the height of the header the harness mounts above it, and the footer is 40px tall. The
 * browser receipts (real layout, light and dark) are in the PR.
 *
 * Two pins: a table that overflows ends at the window bottom less the footer (red on main, where
 * the cap was a per-page `calc(100vh - Nrem)`), and a table of few rows is as tall as its rows
 * and is never stretched to the window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/DataTableFillHarness.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import appLayout from '../../../routes/app/+layout.svelte?raw';
import rootLayout from '../../../routes/+layout.svelte?raw';

const FOOTER_PX = 40;
const mounted: Array<Mounted<Record<string, unknown>>> = [];
let restore: Array<() => void> = [];

beforeEach(() => {
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const header = document.querySelector<HTMLElement>('[data-testid="page-header"]');
    const top = this.getAttribute('data-testid') === 'data-table-scroller' ? Number(header?.dataset.height ?? 0) : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} } as DOMRect;
  });
  const offset = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-testid') === 'table-footer' ? FOOTER_PX : 0;
  });
  restore = [() => rect.mockRestore(), () => offset.mockRestore()];
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  restore.forEach((r) => r());
});

function mountTable(props: Record<string, unknown>) {
  const m = mountComponent(Harness as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target.querySelector<HTMLElement>('[data-testid="data-table-scroller"]')!;
}
const capPx = (el: HTMLElement) => parseFloat(el.style.maxHeight);

describe('DataTable fills the window (portal#2193)', () => {
  it('pin 1, overflowing: the scroller ends at the window bottom less the footer, under a header of any height', () => {
    for (const headerHeight of [120, 333]) {
      const scroller = mountTable({ rows: 60, headerHeight });
      expect(scroller.style.maxHeight).toMatch(/px$/);
      const bottomEdge = headerHeight + capPx(scroller);
      expect(Math.abs(bottomEdge - (800 - FOOTER_PX))).toBeLessThanOrEqual(1);
      mounted.pop()!.unmount();
    }
  });

  it('pin 2, few rows: nothing stretches the table, so it is as tall as its rows with the footer under the last row', () => {
    const scroller = mountTable({ rows: 2, headerHeight: 120 });
    expect(scroller.style.height).toBe('');
    expect(scroller.style.minHeight).toBe('');
    expect(scroller.className).not.toMatch(/(^|\s)(h-|min-h-|flex-1)/);
    // The footer follows the scroller directly in the table's own frame: under the last row,
    // with nothing between them that could hold the window's spare height.
    const footer = scroller.ownerDocument.querySelector('[data-testid="table-footer"]')!;
    expect(footer).not.toBeNull();
    expect(scroller.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.previousElementSibling?.contains(scroller)).toBe(true);
    // And it does not sit at the window bottom: the cap is only a ceiling above the rows' own height.
    expect(scroller.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('resizing the window changes the height with no reload', () => {
    const scroller = mountTable({ rows: 60, headerHeight: 120 });
    const before = capPx(scroller);
    (window as unknown as { innerHeight: number }).innerHeight = 1000;
    window.dispatchEvent(new Event('resize'));
    flushSync();
    expect(capPx(scroller)).toBe(before + 200);
  });

  it('keeps the 200px floor in a short window', () => {
    (window as unknown as { innerHeight: number }).innerHeight = 250;
    expect(capPx(mountTable({ rows: 60, headerHeight: 120 }))).toBe(200);
  });

  it('a table that starts low on the page keeps 40% of the window, not the 200px floor', () => {
    // 800 - 700 - 40 leaves 60px: unfloored it would collapse; the page scrolls to it instead.
    expect(capPx(mountTable({ rows: 60, headerHeight: 700 }))).toBe(320);
  });

  it('bounded keeps one fixed height and never measures', () => {
    const scroller = mountTable({ rows: 60, headerHeight: 120, bounded: true });
    expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
    window.dispatchEvent(new Event('resize'));
    flushSync();
    expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
  });

  it('re-measures when the layout above changes size (ResizeObserver), and watches body and footer', () => {
    const observed: Element[] = [];
    let notify: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb; }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    });
    try {
      const scroller = mountTable({ rows: 60, headerHeight: 120 });
      expect(observed).toContain(document.body);
      expect(observed.some((el) => el.getAttribute('data-testid') === 'table-footer')).toBe(true);
      const before = capPx(scroller);
      document.querySelector<HTMLElement>('[data-testid="page-header"]')!.dataset.height = '220'; // a banner appeared
      notify();
      flushSync();
      expect(capPx(scroller)).toBe(before - 100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('measures when a bounded list becomes a filling one', () => {
    const props = reactiveProps({ rows: 60, headerHeight: 120, bounded: true } as Record<string, unknown>);
    const m = mountComponent(Harness as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    const scroller = m.target.querySelector<HTMLElement>('[data-testid="data-table-scroller"]')!;
    expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
    props.bounded = false;
    flushSync();
    expect(capPx(scroller)).toBe(800 - 120 - FOOTER_PX);
  });

  it('layout contract: no element of the root or app shell other than the sidebar (aside and its nav) scrolls, clips or fixes its height, so the document scrolls', () => {
    // DataTable measures against the document (body observer, window height). If a wrapper of the
    // content ever scrolls or clips (overflow-*, h-screen and friends, an inline overflow or 100vh
    // height), this must change. Every tag's class and style are read, comments stripped, so a
    // token in prose or on another line cannot hide or fake one.
    const SCROLLS = /\boverflow(-[xy])?-(auto|scroll|hidden|clip)\b|(?<!min-)\b(max-)?h-(screen|dvh|svh|lvh)\b|\bfixed\b/;
    const INLINE = /overflow(-[xy])?\s*:\s*(auto|scroll|hidden|clip)|(^|;)\s*height\s*:\s*(calc\()?100d?vh/;
    const offenders: string[] = [];
    for (const [file, source] of [['+layout.svelte', rootLayout], ['app/+layout.svelte', appLayout]] as const) {
      const markup = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
      for (const [, tag, attrs] of markup.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
        const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
        const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? '';
        if ((SCROLLS.test(cls) || INLINE.test(style)) && tag !== 'nav' && tag !== 'aside') offenders.push(`${file}: <${tag}> ${cls} ${style}`.trim());
      }
    }
    expect(offenders).toEqual([]);
  });
});
