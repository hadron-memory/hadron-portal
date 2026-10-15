/**
 * #1086 — a horizontally scrolling tab strip says that it scrolls.
 *
 * CLIENT lane: the action touches the DOM, window, a ResizeObserver and
 * requestAnimationFrame. jsdom has no layout engine, so the geometry the
 * action READS (scroll extents and tab rects) is stubbed explicitly; what is
 * under test is the decision over those numbers and the lifecycle. The
 * rendered fade is the browser QA leg.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import ScrollHintStrip from '$lib/test/fixtures/ScrollHintStrip.svelte';
import { SCROLL_HINT_PAD, overflowEdges, revealScrollLeft, scrollHint } from './scroll-hint';

describe('overflowEdges', () => {
  it('is neither when the content fits', () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      start: false,
      end: false,
    });
  });

  it('is the trailing edge only at the start of a scroller', () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 700, clientWidth: 350 })).toEqual({
      start: false,
      end: true,
    });
  });

  it('is both edges in the middle', () => {
    expect(overflowEdges({ scrollLeft: 100, scrollWidth: 700, clientWidth: 350 })).toEqual({
      start: true,
      end: true,
    });
  });

  it('is the leading edge only at the end, tolerating sub-pixel scroll positions', () => {
    expect(overflowEdges({ scrollLeft: 349.6, scrollWidth: 700, clientWidth: 350 })).toEqual({
      start: true,
      end: false,
    });
  });
});

describe('revealScrollLeft', () => {
  const view = { scrollLeft: 0, clientWidth: 350 };

  it('leaves a visible tab alone', () => {
    expect(revealScrollLeft(view, { start: 100, end: 180 })).toBe(0);
  });

  it('scrolls a tab off the right edge in, clear of the fade', () => {
    expect(revealScrollLeft(view, { start: 600, end: 680 })).toBe(680 - 350 + SCROLL_HINT_PAD);
  });

  it('scrolls a tab off the left edge in, clear of the fade', () => {
    expect(revealScrollLeft({ scrollLeft: 300, clientWidth: 350 }, { start: 100, end: 180 })).toBe(
      100 - SCROLL_HINT_PAD,
    );
  });

  it('never goes negative', () => {
    expect(revealScrollLeft({ scrollLeft: 50, clientWidth: 350 }, { start: 0, end: 80 })).toBe(0);
  });
});

describe('scrollHint (action)', () => {
  let observers: Array<{ cb: () => void; disconnected: boolean }>;
  let frames: Array<() => void>;

  beforeEach(() => {
    observers = [];
    frames = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { cb: () => void; disconnected: boolean };
        constructor(cb: () => void) {
          this.entry = { cb, disconnected: false };
          observers.push(this.entry);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const flushFrames = () => {
    const pending = frames;
    frames = [];
    for (const f of pending) f();
  };

  /** A 350px strip of nine 80px tabs; tab `active` carries data-active. */
  function build(active: number) {
    const strip = document.createElement('div');
    for (let i = 0; i < 9; i++) {
      const tab = document.createElement('button');
      if (i === active) tab.setAttribute('data-active', '');
      tab.getBoundingClientRect = () =>
        ({ left: i * 80 - strip.scrollLeft, right: (i + 1) * 80 - strip.scrollLeft }) as DOMRect;
      strip.append(tab);
    }
    Object.defineProperty(strip, 'scrollWidth', { value: 720 });
    Object.defineProperty(strip, 'clientWidth', { value: 350 });
    strip.getBoundingClientRect = () => ({ left: 0, right: 350 }) as DOMRect;
    document.body.append(strip);
    return strip;
  }

  it('marks the trailing edge on mount when tabs sit off-screen', () => {
    const strip = build(0);
    scrollHint(strip, 'content');
    expect(strip.hasAttribute('data-overflow-end')).toBe(true);
    expect(strip.hasAttribute('data-overflow-start')).toBe(false);
  });

  it('flips the hint as the strip scrolls, and drops it at the end', () => {
    const strip = build(0);
    scrollHint(strip, 'content');

    strip.scrollLeft = 150;
    strip.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(strip.hasAttribute('data-overflow-start')).toBe(true);
    expect(strip.hasAttribute('data-overflow-end')).toBe(true);

    strip.scrollLeft = 370;
    strip.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(strip.hasAttribute('data-overflow-start')).toBe(true);
    expect(strip.hasAttribute('data-overflow-end')).toBe(false);
  });

  it('scrolls a deep-linked active tab into view on mount', () => {
    // Settings: the ninth tab, 640–720px, entirely past the 350px edge.
    const strip = build(8);
    scrollHint(strip, 'settings');
    expect(strip.scrollLeft).toBe(720 - 350 + SCROLL_HINT_PAD);
  });

  it('reveals the new active tab when the active key changes', () => {
    const strip = build(0);
    const action = scrollHint(strip, 'content');
    expect(strip.scrollLeft).toBe(0);

    strip.querySelector('[data-active]')!.removeAttribute('data-active');
    strip.children[6].setAttribute('aria-current', 'page');
    action.update('edges');
    flushFrames(); // the reveal waits a frame for the tabs' attributes to move
    expect(strip.scrollLeft).toBe(560 - 350 + SCROLL_HINT_PAD);
  });

  it('stops listening once destroyed', () => {
    const strip = build(0);
    const action = scrollHint(strip, 'content');
    action.destroy();
    expect(observers.every((o) => o.disconnected)).toBe(true);

    strip.scrollLeft = 150;
    strip.dispatchEvent(new Event('scroll'));
    flushFrames();
    // Still the mount-time state: the destroyed action no longer reacts.
    expect(strip.hasAttribute('data-overflow-start')).toBe(false);
  });

  it('reacts to scroll while live — the other half of the destroy pin', () => {
    const strip = build(0);
    scrollHint(strip, 'content');
    strip.scrollLeft = 150;
    strip.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(strip.hasAttribute('data-overflow-start')).toBe(true);
  });
});

/**
 * Atilla's P2 on #1111, confirmed by Colin on the signed-in node route: Svelte
 * runs the action's `update` BEFORE the static buttons' `data-active`
 * attributes move, so revealing synchronously found the OLD tab and left the
 * new one off-screen (Content → Settings stayed at scrollLeft 0). The unit
 * tests above move the attribute by hand before calling `update`, which is
 * why they could not see it; this mounts a real strip and switches by click.
 */
describe('scrollHint on a mounted strip of static tabs', () => {
  let frames: Array<() => void>;
  const mounted: Array<Mounted<Record<string, unknown>>> = [];
  const restore: Array<() => void> = [];

  /** Stub a prototype member for this test; undone in afterEach. */
  function stub<T extends object>(proto: T, key: string, desc: PropertyDescriptor) {
    const prev = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, ...desc });
    restore.push(() => (prev ? Object.defineProperty(proto, key, prev) : delete (proto as never)[key]));
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => {};
    });
    // Nine 80px tabs in a 350px strip (jsdom has no layout).
    stub(HTMLDivElement.prototype, 'scrollWidth', { get: () => 720 });
    stub(HTMLDivElement.prototype, 'clientWidth', { get: () => 350 });
    stub(HTMLDivElement.prototype, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 350 }) as DOMRect,
    });
    stub(HTMLButtonElement.prototype, 'getBoundingClientRect', {
      value(this: HTMLButtonElement) {
        const i = [...this.parentElement!.children].indexOf(this);
        const left = i * 80 - this.parentElement!.scrollLeft;
        return { left, right: left + 80 } as DOMRect;
      },
    });
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    while (restore.length) restore.pop()!();
    vi.unstubAllGlobals();
  });

  const flushFrames = () => {
    const pending = frames;
    frames = [];
    for (const f of pending) f();
  };

  function mountStrip() {
    const m = mountComponent(ScrollHintStrip as never, {} as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    return m.target.querySelector<HTMLDivElement>('.scroll-hint')!;
  }

  it('reveals the tab a click makes active, after its data-active has moved', () => {
    const strip = mountStrip();
    expect(strip.scrollLeft).toBe(0);

    strip.querySelector<HTMLButtonElement>('button:last-child')!.click();
    flushSync();
    flushFrames();

    expect(strip.querySelector('[data-active]')!.textContent).toBe('settings');
    expect(strip.scrollLeft).toBe(720 - 350 + SCROLL_HINT_PAD);
  });

  it('does not reveal after the strip is destroyed', () => {
    const strip = mountStrip();
    strip.querySelector<HTMLButtonElement>('button:last-child')!.click();
    flushSync();
    mounted.pop()!.unmount();
    flushFrames();
    expect(strip.scrollLeft).toBe(0);
  });
});
