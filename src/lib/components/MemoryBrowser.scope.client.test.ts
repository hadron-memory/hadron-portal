import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

let m: Mounted<Record<string, unknown>> | undefined;
// A fresh default fetch for every case: the only request a scope-driven browser
// may make on its own is the column read, and it answers "all unavailable", the
// shape a withheld nested Memory record produces. Anything else throws, so a
// refused or alternate scope result cannot inherit a previous case's stub.
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/nodes/columns') {
      const { refs } = JSON.parse(String(init?.body)) as { refs: string[] };
      return new Response(JSON.stringify({ rows: [], unavailable: refs, omitted: [] }));
    }
    throw new Error(`Unexpected per-row request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const node = (memoryId: string, name: string, memory: unknown = null) => ({
  id: `${memoryId}-node`,
  memoryId,
  memory,
  urn: `hrn:node:example.com:${memoryId}:note`,
  loc: 'note',
  name,
  nodeType: 'info',
  tags: [],
  seq: null,
  isRunnable: false,
  description: null,
});
const scopeRow = (id: string, name: string) => ({ memoryId: id, memoryUrn: `hrn:mem:example.com:${id}`, name });
const requestedUrls = () => fetchMock.mock.calls.map(call => String(call[0]));
const searchBodies = () =>
  fetchMock.mock.calls
    .filter(call => call[0] === '/api/nodes/search')
    .map(call => JSON.parse(String((call[1] as RequestInit).body)) as { memoryIds: string[] });

function mount(props: Record<string, unknown>) {
  m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  return m;
}
function typeKeyword(target: HTMLElement, value: string) {
  const input = target.querySelector<HTMLInputElement>('input[placeholder="Search content…"]');
  if (!input) throw new Error('no search input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const memoriesMenu = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('Memories'))!;

describe('scope identity in the memory browser (#1043)', () => {
  it('joins withheld nested records by memoryId for filter chips without fetching Memory or Agent records', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      nodes: [node('first', 'First node'), node('role', 'Role node'), node('unknown', 'Unscoped node')],
      multiMemory: true,
      forcedView: 'nodes',
      scopeMemories: [scopeRow('first', 'First memory'), scopeRow('role', 'Role memory')],
    });
    const mounted = mount(props);
    await tick(5);
    expect(mounted.target.querySelector('[title="hrn:node:example.com:unknown:note"]')).toBeTruthy();

    const menu = memoriesMenu(mounted.target);
    expect(menu).toBeTruthy();
    menu.click();
    await tick(2);
    const role = [...mounted.target.querySelectorAll('label')]
      .find(label => label.textContent?.trim() === 'Role memory')!
      .querySelector('input')!;
    expect(role).toBeTruthy();
    role.click();
    await tick(3);
    expect(mounted.target.textContent).toContain('Role node');
    expect(mounted.target.textContent).not.toContain('First node');
    expect(requestedUrls().every(url => url === '/api/nodes/columns')).toBe(true);

    // Updating scope identity must update the same mounted component too.
    props.scopeMemories = [scopeRow('first', 'First memory'), scopeRow('role', 'Renamed role')];
    await tick(3);
    expect(mounted.target.textContent).toContain('Renamed role');
  });

  // The scope identity is the authorized one; a populated nested Memory record
  // on the node is only a fallback. Both carry the SAME urn but DIFFERENT names,
  // so swapping the precedence changes the label the reader sees.
  it('labels a memory by its scope identity even when the node carries a populated nested Memory name', async () => {
    const nested = { id: 'role', urn: 'hrn:mem:example.com:role', name: 'Nested record name' };
    mount({
      nodes: [node('role', 'Role node', nested), node('first', 'First node')],
      multiMemory: true,
      forcedView: 'nodes',
      scopeMemories: [scopeRow('role', 'Scope identity name'), scopeRow('first', 'First memory')],
    });
    await tick(5);
    memoriesMenu(m!.target).click();
    await tick(2);
    const labels = [...m!.target.querySelectorAll('label')].map(label => label.textContent?.trim());
    expect(labels).toContain('Scope identity name');
    expect(labels).not.toContain('Nested record name');
  });
});

// A scope read that failed reaches the browser as scopeMemoryIds = [] (the App
// page maps a null scope to an empty list). With no loaded nodes either, there
// is no memory to search; the browser must not POST a search with an empty
// scope, which the server could widen to its default. Fails closed per
// hrn:node:hadronmemory.com:specs:cor:api:090:02 (a search scope is always
// intersected with the caller's access).
describe('server search on the Memory tab after a scope read (#1043)', () => {
  const SEARCH_DEBOUNCE_MS = 300;
  async function searchFor(props: Record<string, unknown>) {
    vi.useFakeTimers();
    mount(props);
    await tick(3);
    typeKeyword(m!.target, 'needle');
    await tick(3);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50);
    await tick(3);
  }

  it('sends no unscoped search when the scope read failed and no node is loaded', async () => {
    await searchFor({ nodes: [], multiMemory: true, scopeMemoryIds: [], scopeMemories: [] });
    expect(searchBodies()).toEqual([]);
  });

  it('still sends the scoped search when the scope names a memory with no loaded node (control)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/nodes/search') return new Response(JSON.stringify({ nodes: [] }));
      throw new Error(`Unexpected request ${url}`);
    });
    await searchFor({
      nodes: [],
      multiMemory: true,
      scopeMemoryIds: ['role'],
      scopeMemories: [scopeRow('role', 'Role memory')],
    });
    expect(searchBodies().map(body => body.memoryIds)).toEqual([['role']]);
  });
});
