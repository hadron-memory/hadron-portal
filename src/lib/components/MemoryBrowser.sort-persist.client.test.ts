/** portal#1223: the user's explicit Nodes Sort choice survives reload/back, scoped per memory. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const NODES = [
  { id: 'n1', memoryId: 'mem-1', loc: 'a', name: 'Alpha', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [] },
];
const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/nodes/columns') {
      const { refs } = JSON.parse(init!.body as string) as { refs: string[] };
      return new Response(JSON.stringify({ rows: [], unavailable: refs, omitted: [] }));
    }
    if (url !== '/api/nodes/search') throw new Error(`Unexpected test request: ${url}`);
    return new Response(JSON.stringify({ nodes: [], total: 0 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function mountBrowser(basePath = '/app/memories/mem-1') {
  const props = reactiveProps<Record<string, unknown>>({ nodes: NODES, basePath, forcedView: 'nodes', refreshKey: 0 });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { target: m.target, props };
}

function sortSelect(target: HTMLElement) {
  return target.querySelector<HTMLSelectElement>('select[title="Sort order"]')!;
}

function pickSort(target: HTMLElement, value: string) {
  const select = sortSelect(target);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

describe('Nodes sort persistence (portal#1223)', () => {
  it('restores the stored sort on reload/back', async () => {
    window.localStorage.setItem('hadron:memoryBrowser:sort:mem-1', 'updatedAt');
    const { target } = mountBrowser();
    await tick(2);
    expect(sortSelect(target).value).toBe('updatedAt');
  });

  it('leaves the default when no preference is stored (and forces no server view)', async () => {
    const { target } = mountBrowser();
    await tick(2);
    expect(sortSelect(target).value).toBe('loc');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/nodes/search')).toBe(false);
  });

  it('falls back to Location for an invalid or retired stored value', async () => {
    window.localStorage.setItem('hadron:memoryBrowser:sort:mem-1', 'createdAt');
    const { target } = mountBrowser();
    await tick(2);
    expect(sortSelect(target).value).toBe('loc');
  });

  it('persists an explicit change, and a later change overwrites it', async () => {
    const { target } = mountBrowser();
    await tick(2);
    pickSort(target, 'updatedAt');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('updatedAt');
    pickSort(target, 'relevance');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('relevance');
  });

  it('does not leak a sort choice across memories', async () => {
    window.localStorage.setItem('hadron:memoryBrowser:sort:mem-1', 'updatedAt');
    const { target } = mountBrowser('/app/memories/mem-2');
    await tick(2);
    expect(sortSelect(target).value).toBe('loc');
    pickSort(target, 'relevance');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-2')).toBe('relevance');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('updatedAt');
  });

  // SvelteKit reuses the route component across memory navigations, so the
  // scope key can change under a live instance: the new memory must re-seed
  // from its own storage (or the default), never inherit the old memory's
  // choice — and the old choice must not be stamped into the new key.
  it('re-seeds on navigation between memories within one component instance', async () => {
    window.localStorage.setItem('hadron:memoryBrowser:sort:mem-1', 'updatedAt');
    const { target, props } = mountBrowser('/app/memories/mem-1');
    await tick(2);
    expect(sortSelect(target).value).toBe('updatedAt');
    props.basePath = '/app/memories/mem-2';
    await tick(2);
    expect(sortSelect(target).value).toBe('loc');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-2')).toBeNull();
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('updatedAt');
  });

  // An explicit revert to Location is as much a choice as picking a sort:
  // it must persist too, or a reload silently snaps back to the old order —
  // the exact defect this fix exists to close.
  it('persists an explicit revert to Location', async () => {
    const { target } = mountBrowser();
    await tick(2);
    pickSort(target, 'updatedAt');
    pickSort(target, 'loc');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('loc');
    const again = mountBrowser();
    await tick(2);
    expect(sortSelect(again.target).value).toBe('loc');
  });

  // "Clear all" resets the in-view filters for the page at hand; it is not a
  // statement about the user's saved per-memory sort preference.
  it('lets Clear all reset the view without erasing the stored sort', async () => {
    window.localStorage.setItem('hadron:memoryBrowser:sort:mem-1', 'updatedAt');
    const { target } = mountBrowser();
    await tick(2);
    expect(sortSelect(target).value).toBe('updatedAt');
    const clear = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Clear all')!;
    clear.click();
    flushSync();
    expect(sortSelect(target).value).toBe('loc');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('updatedAt');
  });

  // The unscoped (multi-memory) page has no key, so nothing persists or
  // re-seeds there: a transient unscoped render between memory navigations
  // must not discard the user's active sort either.
  it('keeps the active sort when the scope becomes unscoped', async () => {
    const { target, props } = mountBrowser('/app/memories/mem-1');
    await tick(2);
    pickSort(target, 'relevance');
    props.basePath = '/app/memories';
    props.multiMemory = true;
    await tick(2);
    expect(sortSelect(target).value).toBe('relevance');
    expect(window.localStorage.getItem('hadron:memoryBrowser:sort:mem-1')).toBe('relevance');
  });
});
