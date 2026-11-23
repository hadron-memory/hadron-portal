/** #2461 — a DataTable wider than its box says that it scrolls.
 *
 * At 390px the App Secrets table was ~692px in a ~306px box: the scroller is overflow-auto, but a phone
 * browser hides the scrollbar, so the Protection column looked absent. The shared scroller now carries
 * the `scroll-hint` edge fade (#1086) on the edge that has more columns past it. Presentation only: no
 * column is hidden or abbreviated. jsdom has no layout, so the box and content widths are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import TableCuesHarness from '$lib/test/TableCuesHarness.svelte';

const mounted: Array<{ unmount: () => void; target: HTMLElement }> = [];
let frames: Array<() => void> = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const f of pending) f();
};

type CueProps = { rowCount: number };
function scroller() {
  const m = mountComponent<CueProps>(TableCuesHarness, { rowCount: 3 });
  mounted.push(m as unknown as Mounted<Record<string, unknown>>);
  flushSync();
  return m.target.querySelector<HTMLElement>('[data-testid="data-table-scroller"]')!;
}
type Box = { scrollWidth: number; clientWidth: number; scrollLeft?: number };
/** Stand the layout in (jsdom has none) without telling the element anything happened. */
function stand(el: HTMLElement, box: Box) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: box.scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: box.clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: box.scrollLeft ?? 0 });
}
function size(el: HTMLElement, box: Box) {
  stand(el, box);
  el.dispatchEvent(new Event('scroll'));
  flushFrames();
}

/** A ResizeObserver that records what each instance watches and lets a test FIRE its callback, as the browser does when a
 *  watched element changes size. The cue's own instance is the one that watches the scroller. */
function fakeResizeObserver() {
  const instances: Array<{ cb: () => void; targets: Set<Element>; disconnected: boolean }> = [];
  vi.stubGlobal('ResizeObserver', class {
    inst = { cb: () => {}, targets: new Set<Element>(), disconnected: false };
    constructor(cb: () => void) { this.inst.cb = cb; instances.push(this.inst); }
    observe(el: Element) { this.inst.targets.add(el); }
    unobserve(el: Element) { this.inst.targets.delete(el); }
    disconnect() { this.inst.targets.clear(); this.inst.disconnected = true; }
  });
  return { cueObserver: (scrollerEl: Element) => instances.find((i) => i.targets.has(scrollerEl) || i.disconnected)! };
}

describe('DataTable scroll cue (#2461)', () => {
  it('re-measures when the table inside changes width, not only when the box does: the observer callback runs the measurement', () => {
    const fake = fakeResizeObserver();
    const el = scroller();
    const observer = fake.cueObserver(el);
    expect(observer.targets.has(el)).toBe(true);
    expect(observer.targets.has(el.querySelector('table')!)).toBe(true);
    // The table grew; the box did not, and no scroll happened: only the observer can have noticed.
    stand(el, { scrollWidth: 692, clientWidth: 306 });
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    observer.cb();
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
  });

  it('re-measures on a window resize', () => {
    const el = scroller();
    stand(el, { scrollWidth: 692, clientWidth: 306 });
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
  });

  it('follows a replaced table: the new content element is observed and the old one is let go (#2503)', () => {
    const fake = fakeResizeObserver();
    const el = scroller();
    const observer = fake.cueObserver(el);
    const oldChild = el.firstElementChild!;
    expect(observer.targets.has(oldChild)).toBe(true);
    const next = document.createElement('table');
    oldChild.replaceWith(next);
    observer.cb(); // anything that re-measures re-resolves the content element
    expect(observer.targets.has(next)).toBe(true);
    expect(observer.targets.has(oldChild)).toBe(false);
  });

  it('leaves no observer, listener or pending frame behind on unmount', () => {
    const fake = fakeResizeObserver();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const el = scroller();
      const observer = fake.cueObserver(el);
      const resizeAdds = add.mock.calls.filter(([type]) => type === 'resize').map(([, fn]) => fn);
      expect(resizeAdds.length).toBeGreaterThan(0);
      mounted.pop()!.unmount();
      expect(observer.disconnected).toBe(true);
      expect(observer.targets.size).toBe(0);
      // Every window resize listener added by the table is removed again, the same function.
      const resizeRemoves = remove.mock.calls.filter(([type]) => type === 'resize').map(([, fn]) => fn);
      for (const fn of resizeAdds) expect(resizeRemoves).toContain(fn);
      // And a torn-down scroller no longer reacts to the window.
      stand(el, { scrollWidth: 692, clientWidth: 306 });
      window.dispatchEvent(new Event('resize'));
      el.dispatchEvent(new Event('scroll'));
      flushFrames();
      expect(el.hasAttribute('data-overflow-end')).toBe(false);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('has a cue on each edge, after the scroller so the data-overflow-* marks reach it, that never takes a tap', () => {
    const el = scroller();
    for (const edge of ['start', 'end']) {
      const cue = el.parentElement!.querySelector<HTMLElement>(`[data-testid="data-table-scroll-cue-${edge}"]`)!;
      expect(cue).not.toBeNull();
      expect(cue.getAttribute('aria-hidden')).toBe('true');
      expect(cue.classList.contains('pointer-events-none')).toBe(true);
      expect(cue.classList.contains(`table-scroll-cue-${edge}`)).toBe(true);
      expect(Boolean(el.compareDocumentPosition(cue) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(cue.parentElement).toBe(el.parentElement);
    }
  });

  it('marks the end edge when the table is wider than its box, and the start edge once scrolled', () => {
    const el = scroller();
    size(el, { scrollWidth: 692, clientWidth: 306 });
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
    expect(el.hasAttribute('data-overflow-start')).toBe(false);

    size(el, { scrollWidth: 692, clientWidth: 306, scrollLeft: 100 });
    expect(el.hasAttribute('data-overflow-start')).toBe(true);
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
  });

  it('clears the end mark at the end of the scroll', () => {
    const el = scroller();
    size(el, { scrollWidth: 692, clientWidth: 306, scrollLeft: 386 });
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    expect(el.hasAttribute('data-overflow-start')).toBe(true);
  });

  it('shows no cue on a table that fits its box', () => {
    const el = scroller();
    size(el, { scrollWidth: 306, clientWidth: 306 });
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    expect(el.hasAttribute('data-overflow-start')).toBe(false);
  });

  it('keeps every column in the DOM: the cue hides and abbreviates nothing', () => {
    const el = scroller();
    size(el, { scrollWidth: 692, clientWidth: 306 });
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    expect(heads).toHaveLength(2);
    expect(heads[0]).toContain('Name');
    expect(heads[1]).toContain('ID');
  });
});
