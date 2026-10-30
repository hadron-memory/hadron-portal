import { describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import TreeView from './TreeView.svelte';
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
    function mountInScroller() {
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      document.body.appendChild(scroller);
      // jsdom does no layout: scrollTop writes are dropped and clientHeight is 0.
      let top = 0;
      Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { get: () => 600, configurable: true });
      const target = document.createElement('div');
      scroller.appendChild(target);
      const instance = mount(TreeView as never, {
        target, props: { entries: bigTree(), basePath: '/app/memories/m1' },
      });
      flushSync();
      // A real browser moves the tree's rect as the scroller scrolls; jsdom's rects are all zero.
      const nav = target.querySelector('nav') as HTMLElement;
      nav.getBoundingClientRect = () => ({ top: -top } as DOMRect);
      return { scroller, target, done: () => { unmount(instance); scroller.remove(); } };
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

    it('keeps the focused row mounted after it scrolls out of the window', () => {
      const { scroller, target, done } = mountInScroller();
      const link = target.querySelector('.tree-row[data-node-id="r0"] a') as HTMLElement;
      link.focus();
      flushSync();
      scrollTo(scroller, 28 * 3000);
      expect(names(target)).toContain('r0');
      expect(document.activeElement).toBe(link);
      expect(names(target).length).toBeLessThanOrEqual(MAX_ROWS + 1);
      done();
    });
  });
});
