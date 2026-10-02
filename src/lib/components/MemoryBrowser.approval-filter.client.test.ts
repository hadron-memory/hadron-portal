/**
 * #992 — the node list's approval and minting filters are SERVER filters:
 * picking one posts `filter.approvalState` / `filter.minted` to
 * /api/nodes/search (findNodes), and the list shows what comes back. It never
 * reads approval per row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import MemoryBrowser from './MemoryBrowser.svelte';

const NODES = [
  { id: 'n1', memoryId: 'mem-1', loc: 'a', name: 'Alpha', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null },
  { id: 'n2', memoryId: 'mem-1', loc: 'b', name: 'Beta', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null },
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ nodes: [NODES[1]], total: 1 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountBrowser() {
  const m = mountComponent(MemoryBrowser as never, { nodes: NODES, basePath: '/app/memories/mem-1', forcedView: 'nodes' } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

function pick(target: HTMLElement, testid: string, value: string) {
  const select = target.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
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

describe('MemoryBrowser approval and minting filters (#992)', () => {
  it('a bare browse sends no search', async () => {
    mountBrowser();
    expect(await searchBodies()).toEqual([]);
  });

  it('the approval filter posts filter.approvalState and shows the server results', async () => {
    const { target } = mountBrowser();
    pick(target, 'approval-filter', 'SUPERSEDED');
    const bodies = await searchBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].filter).toMatchObject({ approvalState: 'SUPERSEDED', minted: null });
    expect(bodies[0].memoryIds).toEqual(['mem-1']);
    expect(target.textContent).toContain('Beta');
    expect(target.textContent).not.toContain('Alpha');
  });

  it('the minting filter posts filter.minted as a boolean', async () => {
    const { target } = mountBrowser();
    pick(target, 'minted-filter', 'unminted');
    const bodies = await searchBodies();
    expect(bodies[0].filter).toMatchObject({ approvalState: null, minted: false });
  });
});
