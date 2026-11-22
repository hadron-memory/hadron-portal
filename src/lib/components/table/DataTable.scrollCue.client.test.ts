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

const mounted: Array<Mounted<Record<string, unknown>>> = [];
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

function scroller() {
  const m = mountComponent(TableCuesHarness as never, { rowCount: 3 } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target.querySelector<HTMLElement>('[data-testid="data-table-scroller"]')!;
}
function size(el: HTMLElement, box: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: box.scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: box.clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: box.scrollLeft ?? 0 });
  el.dispatchEvent(new Event('scroll'));
  flushFrames();
}

describe('DataTable scroll cue (#2461)', () => {
  it('re-measures when the table inside changes width, not only when the box does', () => {
    const watched: Element[] = [];
    vi.stubGlobal('ResizeObserver', class { observe(el: Element) { watched.push(el); } unobserve() {} disconnect() {} });
    const el = scroller();
    expect(watched).toContain(el);
    expect(watched).toContain(el.querySelector('table'));
  });

  it('has a shade on each edge, after the scroller so the data-overflow-* marks reach it, that never takes a tap', () => {
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
