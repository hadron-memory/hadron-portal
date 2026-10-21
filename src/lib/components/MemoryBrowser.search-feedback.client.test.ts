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

describe('search fallback settings link (#1162)', () => {
  it('links no-index feedback to the current memory settings', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nodes: [], note: 'Semantic search unavailable.', reason: 'no_vector_index', degraded: [] })));
    const { target } = mountBrowser();
    pick(target, 'ALL');
    await searchBodies();
    await vi.waitFor(() => {
      flushSync();
      expect(target.querySelector('a[href="/app/memories/mem-1/settings#vector-index"]')?.textContent).toBe('Open vector index settings');
    });
  });
  it('does not confuse a failed search with no index', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Search failed', reason: 'no_vector_index' }), {status: 500}));
    const { target } = mountBrowser();
    pick(target, 'ALL');
    await searchBodies();
    await vi.waitFor(() => {
      flushSync();
      expect(target.textContent).toContain('Search failed');
      expect(target.querySelector('a[href$="#vector-index"]')).toBeNull();
    });
  });
});
