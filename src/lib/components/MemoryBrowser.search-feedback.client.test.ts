/** #1162: search feedback must remain correct beside the independent column read. */
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
let searchPayload: Record<string, unknown>;
let searchStatus: number;
beforeEach(() => {
  vi.useFakeTimers();
  searchPayload = {nodes: [], total: 0};
  searchStatus = 200;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    // Main also reads visible-row columns. Never share a consumed Response,
    // or let that independent request steal the search result fixture.
    if (url === '/api/nodes/columns') {
      const {refs} = JSON.parse(init!.body as string) as {refs: string[]};
      return new Response(JSON.stringify({rows: [], unavailable: refs, omitted: []}));
    }
    if (url !== '/api/nodes/search') throw new Error(`Unexpected test request: ${url}`);
    return new Response(JSON.stringify(searchPayload), {status: searchStatus});
  });
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
    searchPayload = {nodes: [], note: 'Semantic search unavailable.', reason: 'no_vector_index', degraded: []};
    const { target } = mountBrowser();
    pick(target, 'ALL');
    await searchBodies();
    await vi.waitFor(() => {
      flushSync();
      expect(target.querySelector('a[href="/app/memories/mem-1/settings#vector-index"]')?.textContent).toBe('Open vector index settings');
    });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/nodes/columns')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/nodes/search')).toBe(true);
  });
  it('does not confuse a failed search with no index', async () => {
    searchPayload = {error: 'Search failed', reason: 'no_vector_index'};
    searchStatus = 500;
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
