/**
 * portal#1015 (hrn:node:hadronmemory.com:specs:cor:dmo:110:08) — Content / Comments / All is a SERVER filter.
 * Picking a scope posts `filter.contentScope` to /api/nodes/search and shows
 * what comes back; the browser never filters a returned page. A comment the
 * reader asked for is a result, so it is not hidden like the tree's comments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const NODES = [
  { id: 'n1', memoryId: 'mem-1', loc: 'a', name: 'Alpha', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [] },
];
const COMMENT_HIT = {
  id: 'c1', memoryId: 'mem-1', loc: 'comments:c1', name: 'Needs a source', nodeType: 'comment', tags: [], seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-1', urn: 'hrn:mem:o:m', name: 'm' },
  comment: {
    id: 'c1', isTopLevel: true, state: 'OPEN', anchorRevision: 1, deleted: false,
    author: { kind: 'USER', user: { id: 'u1', name: 'Ann', handle: 'ann', urn: null }, worker: null, agent: null, app: null },
    target: { id: 'n1', name: 'Alpha', nodeType: 'info', revSeq: 1, urn: 'hrn:node:o:m:a' },
  },
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ nodes: [COMMENT_HIT], total: 1 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountBrowser() {
  const props = reactiveProps<Record<string, unknown>>({ nodes: NODES, basePath: '/app/memories/mem-1', forcedView: 'nodes', refreshKey: 0 });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

function pick(target: HTMLElement, value: string) {
  const select = target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!;
  expect(select).not.toBeNull();
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

async function searchBodies() {
  await vi.advanceTimersByTimeAsync(400);
  await tick();
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/nodes/search')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('MemoryBrowser content scope (portal#1015)', () => {
  it('defaults to Content: no search is sent', async () => {
    const { target } = mountBrowser();
    expect(target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!.value).toBe('CONTENT');
    expect(await searchBodies()).toEqual([]);
  });

  it('Comments posts filter.contentScope and shows the comment rows it returns', async () => {
    const { target } = mountBrowser();
    pick(target, 'COMMENTS');
    const bodies = await searchBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].filter).toMatchObject({ contentScope: 'COMMENTS' });
    expect(bodies[0].memoryIds).toEqual(['mem-1']);
    expect(target.querySelector('[data-testid="comment-hit"]')).not.toBeNull();
    expect(target.textContent).toContain('Needs a source');
  });

  it('a comment the reader asked for is not hidden like the tree\'s comments', async () => {
    const { target } = mountBrowser();
    pick(target, 'ALL');
    const bodies = await searchBodies();
    expect(bodies[0].filter).toMatchObject({ contentScope: 'ALL' });
    expect(target.querySelector('[data-testid="comment-hit"]')).not.toBeNull();
  });

  it('shows comment results in the table only: no view or pane toggles while they are on (#1057)', async () => {
    // A reader who last chose the Nodes view with the Tree pane: Comments must not land them in the tree.
    window.localStorage.setItem('hadron:memoryBrowser:viewMode', 'nodes');
    window.localStorage.setItem('hadron:memoryBrowser:nodesPane', 'tree');
    const props = reactiveProps<Record<string, unknown>>({ nodes: NODES, basePath: '/app/memories/mem-1', refreshKey: 0 });
    const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const { target } = m;
    expect(target.querySelector('[aria-label="Browser view"]')).not.toBeNull();
    pick(target, 'COMMENTS');
    await searchBodies();
    expect(target.querySelector('[data-testid="comment-hit"]')).not.toBeNull();
    expect(target.querySelector('[aria-label="Browser view"]')).toBeNull();
    expect(target.querySelector('[aria-label="Nodes layout"]')).toBeNull();
    pick(target, 'CONTENT');
    await searchBodies();
    expect(target.querySelector('[aria-label="Browser view"]')).not.toBeNull();
    window.localStorage.clear();
  });

  it('going back to Content stops the server search', async () => {
    const { target } = mountBrowser();
    pick(target, 'COMMENTS');
    await searchBodies();
    fetchMock.mockClear();
    pick(target, 'CONTENT');
    expect(await searchBodies()).toEqual([]);
    expect(target.querySelector('[data-testid="comment-hit"]')).toBeNull();
  });
});
