/**
 * portal#2193 (ruling 0276) — a full-page DataTable fills the window below its own top edge, with
 * no per-page offset. jsdom does not lay out, so the geometry is stood in for: the scroller's top
 * is the height of the header the harness mounts above it, and the footer is 40px tall. The
 * browser receipts (real layout, light and dark) are in the PR.
 *
 * Two pins: a table that overflows ends at the window bottom less the footer (red on main, where
 * the cap was a per-page `calc(100vh - Nrem)`), and a table of few rows is as tall as its rows
 * and is never stretched to the window. Scroll ownership and the footer after a layout change are
 * asserted in real Chromium by scripts/test-data-table-fill-layout.mjs (portal#2367).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/DataTableFillHarness.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

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

/** A ResizeObserver that, like the real one, calls back only for elements that were observed and
 *  then resized: `resized(el)` is that element changing size. */
function fakeObserver() {
  const instances: Array<{ cb: () => void; targets: Set<Element> }> = [];
  vi.stubGlobal('ResizeObserver', class {
    cb: () => void;
    targets = new Set<Element>();
    constructor(cb: () => void) { this.cb = cb; instances.push(this); }
    observe(el: Element) { this.targets.add(el); }
    unobserve(el: Element) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  });
  return {
    get observed() { return instances.flatMap((i) => [...i.targets]); },
    live() { return instances.flatMap((i) => [...i.targets]); },
    /** What the FILL machinery watches: everything but the scroller and its table, which the
     *  scroll cue (#2461) observes in every mode. */
    fillWatched(scroller: Element) { return instances.flatMap((i) => [...i.targets]).filter((el) => el !== scroller && el !== scroller.firstElementChild); },
    resized(el: Element) { for (const i of instances) if (i.targets.has(el)) i.cb(); },
  };
}

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

  it('bounded keeps one fixed height and registers no observer or resize listener', () => {
    const fake = fakeObserver();
    const add = vi.spyOn(window, 'addEventListener');
    try {
      const scroller = mountTable({ rows: 60, headerHeight: 120, bounded: true });
      expect(fake.fillWatched(scroller)).toEqual([]);
      // The scroll cue (#2461) keeps its own single resize listener in every mode; fill adds none.
      expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
      expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
      window.dispatchEvent(new Event('resize'));
      flushSync();
      expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
    } finally {
      add.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('contentHeight lets the scroll area grow to its rows, so no row is cut, and registers no observer (#2535)', () => {
    const fake = fakeObserver();
    try {
      const scroller = mountTable({ rows: 60, headerHeight: 120, contentHeight: true });
      expect(fake.fillWatched(scroller)).toEqual([]);
      expect(scroller.style.maxHeight).toBe('none');
      window.dispatchEvent(new Event('resize'));
      flushSync();
      expect(scroller.style.maxHeight).toBe('none');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('switching modes both ways: filling starts observing, bounded stops and disconnects', () => {
    const fake = fakeObserver();
    try {
      const props = reactiveProps({ rows: 60, headerHeight: 120, bounded: false } as Record<string, unknown>);
      const m = mountComponent(Harness as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      flushSync();
      const scroller = m.target.querySelector<HTMLElement>('[data-testid="data-table-scroller"]')!;
      expect(fake.live()).toContain(document.body);
      props.bounded = true;
      flushSync();
      expect(fake.fillWatched(scroller)).toEqual([]);
      expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
      // A resize while bounded changes nothing.
      (window as unknown as { innerHeight: number }).innerHeight = 1000;
      window.dispatchEvent(new Event('resize'));
      flushSync();
      expect(scroller.style.maxHeight).toBe('max(200px, 40vh)');
      props.bounded = false;
      flushSync();
      expect(fake.live()).toContain(document.body);
      expect(capPx(scroller)).toBe(1000 - 120 - FOOTER_PX);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a header above that grows, with no body or footer resize, keeps the footer inside the window', () => {
    const fake = fakeObserver();
    try {
      const scroller = mountTable({ rows: 60, headerHeight: 120 });
      const header = document.querySelector<HTMLElement>('[data-testid="page-header"]')!;
      const footer = document.querySelector<HTMLElement>('[data-testid="table-footer"]')!;
      header.dataset.height = '320'; // the header wrapped onto more lines
      // A real ResizeObserver reports only the elements that changed size: here, the header.
      fake.resized(header);
      flushSync();
      expect(footer).not.toBeNull();
      expect(320 + capPx(scroller) + FOOTER_PX).toBeLessThanOrEqual(800);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a banner that mounts above after setup is watched and measured, and one that unmounts stops being watched', async () => {
    const fake = fakeObserver();
    try {
      const scroller = mountTable({ rows: 60, headerHeight: 120 });
      const header = document.querySelector<HTMLElement>('[data-testid="page-header"]')!;
      const before = capPx(scroller);
      // Mounted after setup, with the body and footer keeping their size.
      const banner = document.createElement('div');
      banner.setAttribute('data-testid', 'banner');
      header.before(banner);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(fake.live()).toContain(banner);
      header.dataset.height = '200'; // the header shifts the table down with the banner present
      fake.resized(banner);
      flushSync();
      expect(capPx(scroller)).toBe(before - 80);
      banner.remove();
      await new Promise((r) => setTimeout(r, 0));
      expect(fake.live()).not.toContain(banner);
    } finally {
      vi.unstubAllGlobals();
    }
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
});
