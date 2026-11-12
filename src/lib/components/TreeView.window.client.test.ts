import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import TreeView from './TreeView.svelte';
import { graphState } from './GraphState.svelte.js';
import type { TreeEntry } from '$lib/types';

// #1381 Slice 2: the Nodes tree renders a bounded window of rows whatever the
// expanded size. Acceptance 2 is "at most 3,000 DOM elements" for a ~5,500-row
// expansion; each row is ~6 elements, so the row bound below is what holds it.
const MAX_ROWS = 150;

const entry = (id: string, name = id): TreeEntry => ({
  id, nodeId: `pk-${id}`, name, seq: null, nodeType: 'info', hasActions: false, isVirtual: false,
});

/** 11 roots x 500 children = 5,511 rows once every root is expanded (top level opens by default). */
function bigTree(): TreeEntry[] {
  const out: TreeEntry[] = [];
  for (let r = 0; r < 11; r++) {
    out.push(entry(`r${r}`));
    for (let c = 0; c < 500; c++) out.push(entry(`r${r}:c${String(c).padStart(4, '0')}`));
  }
  return out;
}

describe('TreeView bounded window (#1381)', () => {
  it('renders a bounded number of rows for a 5,500-row expansion', () => {
    const { target, unmount } = mountComponent(TreeView as never, {
      entries: bigTree(), basePath: '/app/memories/m1',
    } as never);
    const rows = target.querySelectorAll('.tree-row').length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(MAX_ROWS);
    expect(target.querySelectorAll('*').length).toBeLessThanOrEqual(3000);
    unmount();
  });

  it('keeps the full expanded height so the scrollbar is honest', () => {
    const { target, unmount } = mountComponent(TreeView as never, {
      entries: bigTree(), basePath: '/app/memories/m1',
    } as never);
    const nav = target.querySelector('nav.tree-view') as HTMLElement;
    expect(nav.dataset.rowCount).toBe('5511');
    unmount();
  });

  it('small trees still render every row', () => {
    const { target, unmount } = mountComponent(TreeView as never, {
      entries: [entry('a'), entry('a:b'), entry('c')], basePath: '/app/memories/m1',
    } as never);
    expect(target.querySelectorAll('.tree-row')).toHaveLength(3);
    unmount();
  });

  it('collapsing a root removes its rows from the flattened list', () => {
    const { target, unmount } = mountComponent(TreeView as never, {
      entries: bigTree(), basePath: '/app/memories/m1',
    } as never);
    const chevron = target.querySelector('.tree-row .chevron') as HTMLButtonElement;
    chevron.click();
    flushSync();
    const nav = target.querySelector('nav.tree-view') as HTMLElement;
    expect(nav.dataset.rowCount).toBe('5011');
    unmount();
  });

  describe('inside a scroller', () => {
    function mountInScroller({ banner = false }: { banner?: boolean } = {}) {
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      document.body.appendChild(scroller);
      // jsdom does no layout: scrollTop writes are dropped and clientHeight is 0.
      let top = 0;
      Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { get: () => 600, configurable: true });
      // Content above the tree inside the scroller (MemoryBrowser's move-error
      // banner). Its height shifts the tree; jsdom has no layout, so `above` is
      // the height the mocked rect below reports.
      const above = { px: 0, el: null as HTMLElement | null };
      if (banner) {
        above.el = document.createElement('p');
        scroller.appendChild(above.el);
      }
      const target = document.createElement('div');
      scroller.appendChild(target);
      const instance = mount(TreeView as never, {
        target, props: { entries: bigTree(), basePath: '/app/memories/m1' },
      });
      flushSync();
      // A real browser moves the tree's rect as the scroller scrolls; jsdom's rects are all zero.
      const nav = target.querySelector('nav') as HTMLElement;
      nav.getBoundingClientRect = () => ({ top: -top + above.px } as DOMRect);
      return { scroller, target, above, done: () => { unmount(instance); scroller.remove(); } };
    }
    const scrollTo = (scroller: HTMLElement, top: number) => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      flushSync();
    };
    const names = (target: HTMLElement) =>
      [...target.querySelectorAll('.tree-row')].map((r) => (r as HTMLElement).dataset.nodeId);

    it('moves the window with scrollTop and stays bounded', () => {
      const { scroller, target, done } = mountInScroller();
      expect(names(target)).toContain('r0');
      scrollTo(scroller, 28 * 3000);
      const after = names(target);
      expect(after.length).toBeLessThanOrEqual(MAX_ROWS);
      expect(after).not.toContain('r0');
      // The first mounted row is flattened index 3000 minus the overscan; padding stands in for the rows above.
      const nav = target.querySelector('nav') as HTMLElement;
      expect(nav.style.paddingTop).toBe(`${(3000 - 20) * 28 + 4}px`);
      done();
    });

    it('extends the window when focus reaches its edge so Tab keeps landing on rows', () => {
      const { target, done } = mountInScroller();
      const rows = [...target.querySelectorAll('.tree-row')] as HTMLElement[];
      const before = rows.length;
      (rows[rows.length - 1].querySelector('a') as HTMLElement).focus();
      flushSync();
      expect(target.querySelectorAll('.tree-row').length).toBeGreaterThan(before);
      done();
    });

    it('scrolls a selected node outside the window into view by position', async () => {
      const { scroller, target, done } = mountInScroller();
      const scrollToCalls: ScrollToOptions[] = [];
      scroller.scrollTo = ((o: ScrollToOptions) => { scrollToCalls.push(o); }) as never;
      graphState.selectedNodeId = 'pk-r5:c0300';
      flushSync();
      await new Promise((r) => setTimeout(r, 0));
      // Not mounted (far outside the window), yet the scroller was sent to its computed row.
      expect(target.querySelector('.tree-row[data-node-id="r5:c0300"]')).toBeNull();
      expect(scrollToCalls).toHaveLength(1);
      expect(scrollToCalls[0].top).toBeGreaterThan(28 * 1000);
      graphState.selectedNodeId = null;
      done();
    });

    // #1488 item 1: a focused row pinned far outside the window is first or
    // last in the DOM, so a native Tab from it would leave the tree. jsdom does
    // no native tab navigation, so these assert the handler's own move.
    const rowOf = (el: Element | null) => (el as HTMLElement | null)?.closest<HTMLElement>('.tree-row')?.dataset.nodeId;
    const press = (el: HTMLElement, shiftKey = false) => {
      const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      flushSync();
      return ev;
    };
    function pinFar(id: string) {
      const mounted = mountInScroller();
      const link = mounted.target.querySelector(`.tree-row[data-node-id="${id}"] a`) as HTMLElement;
      link.focus();
      flushSync();
      scrollTo(mounted.scroller, 28 * 3000);
      expect((mounted.target.querySelector(`.tree-row[data-node-id="${id}"]`) as HTMLElement).style.position).toBe('absolute');
      return { ...mounted, link };
    }

    it('Tab from a far pinned row moves into the next row in index order (#1488)', () => {
      const { done, link } = pinFar('r0:c0010');
      const ev = press(link);
      expect(ev.defaultPrevented).toBe(true);
      expect(rowOf(document.activeElement)).toBe('r0:c0011');
      // And again: the newly focused row is itself pinned far from the window.
      press(document.activeElement as HTMLElement);
      expect(rowOf(document.activeElement)).toBe('r0:c0012');
      done();
    });

    it('Shift+Tab from a far pinned row moves into the previous row in index order (#1488)', () => {
      const { done, link } = pinFar('r0:c0010');
      press(link, true);
      expect(rowOf(document.activeElement)).toBe('r0:c0009');
      done();
    });

    it('Tab inside a pinned row, or past either end of the tree, is left to the browser (#1488)', () => {
      const { done, link } = pinFar('r0');
      // r0 has a chevron before its link, so Shift+Tab from the link stays in the row.
      expect(press(link, true).defaultPrevented).toBe(false);
      // r0 is index 0: Shift+Tab from its chevron leaves the tree, as it should.
      const chevron = link.closest('.tree-row')!.querySelector('.chevron') as HTMLElement;
      chevron.focus();
      flushSync();
      expect(press(chevron, true).defaultPrevented).toBe(false);
      done();
    });

    // #1488 item 2: the window's offset inside the scroller moves when content
    // above the tree changes, with no scroll and no scroller resize.
    describe('content above the tree', () => {
      class FakeResizeObserver {
        static all: FakeResizeObserver[] = [];
        targets = new Set<Element>();
        constructor(private cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
        observe(el: Element) { this.targets.add(el); }
        unobserve(el: Element) { this.targets.delete(el); }
        disconnect() { this.targets.clear(); }
        fire(el: Element) { if (this.targets.has(el)) this.cb([{ target: el } as ResizeObserverEntry], this as never); }
      }
      const resized = (el: Element) => { for (const o of FakeResizeObserver.all) o.fire(el); flushSync(); };
      afterEach(() => { vi.unstubAllGlobals(); FakeResizeObserver.all = []; });
      const padTop = (target: HTMLElement) => (target.querySelector('nav') as HTMLElement).style.paddingTop;

      it('a banner above the tree growing moves the window with no scroll event', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { scroller, target, above, done } = mountInScroller({ banner: true });
        scrollTo(scroller, 28 * 3000);
        expect(padTop(target)).toBe(`${(3000 - 20) * 28 + 4}px`);
        above.px = 28 * 200;
        resized(above.el!);
        expect(padTop(target)).toBe(`${(2800 - 20) * 28 + 4}px`);
        done();
      });

      it('a banner inserted above the tree moves the window with no scroll event', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { scroller, target, above, done } = mountInScroller();
        scrollTo(scroller, 28 * 3000);
        above.px = 28 * 200;
        scroller.insertBefore(document.createElement('p'), scroller.firstChild);
        await Promise.resolve();
        flushSync();
        expect(padTop(target)).toBe(`${(2800 - 20) * 28 + 4}px`);
        done();
      });

      // #1566: removing the element above the tree moves the tree too, with no
      // resize of anything still observed. The MutationObserver must re-measure.
      it('a banner above the tree being removed moves the window with no scroll event', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { scroller, target, above, done } = mountInScroller({ banner: true });
        scrollTo(scroller, 28 * 3000);
        above.px = 28 * 200;
        resized(above.el!);
        expect(padTop(target)).toBe(`${(2800 - 20) * 28 + 4}px`);
        above.el!.remove();
        above.px = 0;
        await Promise.resolve();
        flushSync();
        expect(padTop(target)).toBe(`${(3000 - 20) * 28 + 4}px`);
        done();
      });

      // #1566: a preceding sibling of an ancestor of the tree (one level up,
      // between the scroller and the tree's wrapper) resizing moves the tree.
      it('a sibling above an ancestor of the tree resizing moves the window with no scroll event', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        document.body.appendChild(scroller);
        let top = 0;
        Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { get: () => 600, configurable: true });
        const aboveAncestor = document.createElement('p');
        const wrapper = document.createElement('section');
        scroller.append(aboveAncestor, wrapper);
        const target = document.createElement('div');
        wrapper.appendChild(target);
        const instance = mount(TreeView as never, { target, props: { entries: bigTree(), basePath: '/app/memories/m1' } });
        flushSync();
        let px = 0;
        (target.querySelector('nav') as HTMLElement).getBoundingClientRect = () => ({ top: -top + px } as DOMRect);
        scrollTo(scroller, 28 * 3000);
        expect(padTop(target)).toBe(`${(3000 - 20) * 28 + 4}px`);
        px = 28 * 200;
        resized(aboveAncestor);
        expect(padTop(target)).toBe(`${(2800 - 20) * 28 + 4}px`);
        unmount(instance);
        scroller.remove();
      });
    });

    it('keeps the focused row mounted after it scrolls out of the window', () => {
      const { scroller, target, done } = mountInScroller();
      const link = target.querySelector('.tree-row[data-node-id="r0"] a') as HTMLElement;
      link.focus();
      flushSync();
      scrollTo(scroller, 28 * 3000);
      expect(names(target)).toContain('r0');
      expect(document.activeElement).toBe(link);
      expect(names(target).length).toBeLessThanOrEqual(MAX_ROWS + 1);
      // The pinned row sits at its own index offset, out of flow: it must not add height
      // to (or shift) the padded window (BLIND P2 on #1486).
      const row = target.querySelector('.tree-row[data-node-id="r0"]') as HTMLElement;
      expect(row.style.position).toBe('absolute');
      expect(row.style.top).toBe('4px');
      done();
    });
  });
});
