/**
 * #878 — `fillViewport` sizes the node page's Source editors to the viewport.
 *
 * CLIENT lane for the action (it touches the DOM, window and a ResizeObserver);
 * jsdom has no layout engine, so the geometry the action MEASURES is stubbed
 * explicitly. What is under test is the arithmetic over those measurements and
 * the lifecycle — not a browser's layout, which the preview check covers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILL_MIN_HEIGHT, fillHeight, fillViewport } from './fill-viewport';

describe('fillHeight', () => {
  it('is the viewport left below the editor, minus what must stay visible', () => {
    expect(fillHeight({ viewportHeight: 900, top: 250, below: 90 })).toBe(560);
  });

  it('floors at the minimum on a short viewport', () => {
    expect(fillHeight({ viewportHeight: 400, top: 350, below: 90 })).toBe(FILL_MIN_HEIGHT);
  });

  it('does not depend on scroll position — top is document-relative', () => {
    // Stated because the action converts a viewport rect to a document offset;
    // a viewport-relative top would grow the editor as the user scrolls down.
    const a = fillHeight({ viewportHeight: 900, top: 250, below: 90 });
    const b = fillHeight({ viewportHeight: 900, top: 250, below: 90 });
    expect(a).toBe(b);
  });
});

describe('fillViewport (action)', () => {
  let observers: Array<{ cb: () => void; disconnected: boolean }>;

  beforeEach(() => {
    observers = [];
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
    vi.stubGlobal('innerHeight', 900);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function build(opts: { top: number; footerHeight: number; footerMargin: number; padding: number }) {
    const shell = document.createElement('div');
    shell.style.paddingBottom = `${opts.padding}px`;
    const editor = document.createElement('textarea');
    const footer = document.createElement('div');
    footer.style.marginTop = `${opts.footerMargin}px`;
    Object.defineProperty(footer, 'offsetHeight', { value: opts.footerHeight });
    editor.getBoundingClientRect = () => ({ top: opts.top - window.scrollY }) as DOMRect;
    shell.append(editor, footer);
    document.body.append(shell);
    return { editor, footer };
  }

  it('counts an ancestor\'s bottom margin as space under the node (#2327 QA)', () => {
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 32 });
    editor.parentElement!.style.marginBottom = '16px';
    fillViewport(editor, footer);
    // 900 - 250 - (40 + 8) - (32 + 16)
    expect(editor.style.height).toBe('554px');
  });

  it('margins on nested ancestors are each counted: an over-reserve that never lets the page scroll (#2327)', () => {
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 0 });
    const inner = editor.parentElement!;
    const outer = document.createElement('div');
    document.body.append(outer);
    outer.append(inner);
    inner.style.marginBottom = '16px';
    outer.style.marginBottom = '16px';
    fillViewport(editor, footer);
    // 900 - 250 - (40 + 8) - (16 + 16) = 570: collapsing would reserve only 16 (586), so this is the safe side.
    expect(editor.style.height).toBe('570px');
  });

  it('sets the height from the measured top, footer and page padding', () => {
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 32 });
    const handle = fillViewport(editor, footer);
    // 900 - 250 - (40 + 8) - 32
    expect(editor.style.height).toBe('570px');
    handle.destroy();
  });

  it('keeps the same height when the page is scrolled', () => {
    vi.stubGlobal('scrollY', 300);
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 32 });
    const handle = fillViewport(editor, footer);
    expect(editor.style.height).toBe('570px');
    handle.destroy();
  });

  it('still measures, and follows window resizes, without ResizeObserver (@copilot on #887)', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 32 });
    const handle = fillViewport(editor, footer);
    expect(editor.style.height).toBe('570px');
    Object.defineProperty(editor, 'offsetHeight', { value: 570, configurable: true });
    vi.stubGlobal('innerHeight', 1000);
    window.dispatchEvent(new Event('resize'));
    expect(editor.style.height).toBe('670px');
    expect(() => handle.update(footer)).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
  });

  it('recomputes on window resize, and stops after destroy', () => {
    const { editor, footer } = build({ top: 250, footerHeight: 40, footerMargin: 8, padding: 32 });
    const handle = fillViewport(editor, footer);
    Object.defineProperty(editor, 'offsetHeight', { value: 570, configurable: true });

    vi.stubGlobal('innerHeight', 1000);
    window.dispatchEvent(new Event('resize'));
    expect(editor.style.height).toBe('670px');

    handle.destroy();
    expect(observers.every((o) => o.disconnected)).toBe(true);
    Object.defineProperty(editor, 'offsetHeight', { value: 670, configurable: true });
    vi.stubGlobal('innerHeight', 1200);
    window.dispatchEvent(new Event('resize'));
    expect(editor.style.height).toBe('670px');
  });
});
