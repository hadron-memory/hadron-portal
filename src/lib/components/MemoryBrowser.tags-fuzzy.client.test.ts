/** portal#1220: the Tags filter dropdown must list tags in Fuzzy mode too. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const NODES = [
  { id: 'n1', memoryId: 'mem-1', loc: 'a', name: 'Alpha', nodeType: 'info', tags: ['qa'], seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [] },
  { id: 'n2', memoryId: 'mem-1', loc: 'b', name: 'Beta', nodeType: 'info', tags: ['sorting'], seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [] },
];
const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let searchPayload: Record<string, unknown>;
let searchStatus: number;
beforeEach(() => {
  vi.useFakeTimers();
  searchPayload = { nodes: [], total: 0 };
  searchStatus = 200;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/nodes/columns') {
      const { refs } = JSON.parse(init!.body as string) as { refs: string[] };
      return new Response(JSON.stringify({ rows: [], unavailable: refs, omitted: [] }));
    }
    if (url !== '/api/nodes/search') throw new Error(`Unexpected test request: ${url}`);
    return new Response(JSON.stringify(searchPayload), { status: searchStatus });
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

function clickButton(target: HTMLElement, text: string) {
  const button = [...target.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim().startsWith(text))!;
  expect(button).toBeDefined();
  button.click();
  flushSync();
  return button;
}

function openTagsList(target: HTMLElement) {
  clickButton(target, 'Tags');
  return [...target.querySelectorAll('.filter-dropdown label')]
    .map((l) => l.textContent?.trim())
    .filter((t) => t !== 'Clear');
}

describe('tags filter dropdown across search modes (#1220)', () => {
  it("lists the loaded set's tags after switching to Fuzzy with no query", () => {
    const { target } = mountBrowser();
    clickButton(target, 'Fuzzy');
    expect(openTagsList(target)).toEqual(['qa', 'sorting']);
  });

  it('keeps offering tags while a Fuzzy query’s server results are the working set', async () => {
    searchPayload = { nodes: [NODES[1]], total: 1 };
    const { target } = mountBrowser();
    clickButton(target, 'Fuzzy');
    const input = target.querySelector<HTMLInputElement>('input[placeholder="Search content…"]')!;
    input.value = 'sort';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(400);
    await tick();
    // The server view is active (one hit shown); the Tags dropdown must still
    // offer the tags, and picking one must keep filtering the FUZZY hits.
    expect(target.textContent).toContain('Beta');
    expect(openTagsList(target)).toEqual(['qa', 'sorting']);
    const qa = [...target.querySelectorAll('.filter-dropdown label')]
      .find((l) => l.textContent?.trim() === 'qa')!
      .querySelector('input')!;
    qa.click();
    await vi.waitFor(() => {
      flushSync();
      expect(target.textContent).not.toContain('Beta');
    });
  });

  it('still offers tags when Fuzzy degrades for a missing vector index', async () => {
    searchPayload = { nodes: [], total: 0, note: 'Semantic search unavailable.', reason: 'no_vector_index', degraded: [] };
    const { target } = mountBrowser();
    clickButton(target, 'Fuzzy');
    const input = target.querySelector<HTMLInputElement>('input[placeholder="Search content…"]')!;
    input.value = 'sort';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(400);
    await tick();
    expect(openTagsList(target)).toEqual(['qa', 'sorting']);
  });

  it('still offers tags when the Fuzzy search errors out', async () => {
    searchPayload = { error: 'Search failed' };
    searchStatus = 500;
    const { target } = mountBrowser();
    clickButton(target, 'Fuzzy');
    const input = target.querySelector<HTMLInputElement>('input[placeholder="Search content…"]')!;
    input.value = 'sort';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(400);
    await tick();
    expect(target.textContent).toContain('Search failed');
    expect(openTagsList(target)).toEqual(['qa', 'sorting']);
  });
});
