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
  window.localStorage.clear();
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
  window.localStorage.clear();
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
const serverPage = { offset: 0, count: 2, total: 2, firstHref: null, previousHref: null, nextHref: null };
const searchBodies = () =>
  fetchMock.mock.calls
    .filter(call => call[0] === '/api/nodes/search')
    .map(call => JSON.parse(String((call[1] as RequestInit).body)) as { memoryIds: string[]; filter?: { nodeTypes?: string[]; tags?: string[] } });

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
  it('joins withheld nested records by memoryId for filter chips and filters the whole scope', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/nodes/search') return new Response(JSON.stringify({ nodes: [node('role', 'Role node')] }));
      if (url === '/api/nodes/columns') {
        const { refs } = JSON.parse(String(init?.body)) as { refs: string[] };
        return new Response(JSON.stringify({ rows: [], unavailable: refs, omitted: [] }));
      }
      throw new Error(`Unexpected per-row request ${url}`);
    });
    const props = reactiveProps<Record<string, unknown>>({
      nodes: [node('first', 'First node'), node('unknown', 'Unscoped node')],
      multiMemory: true,
      forcedView: 'nodes',
      scopeMemories: [scopeRow('first', 'First memory'), scopeRow('role', 'Role memory')],
      serverPage,
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
    await vi.advanceTimersByTimeAsync(350);
    await tick(3);
    expect(mounted.target.textContent).toContain('Role node');
    expect(mounted.target.textContent).not.toContain('First node');
    expect(searchBodies().map(body => body.memoryIds)).toEqual([['role']]);

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
  it('sends type and tag filters to the server instead of narrowing only the loaded page', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/nodes/search') {
        const body = JSON.parse(String(init?.body)) as { filter?: { tags?: string[] } };
        const tag = body.filter?.tags?.[0];
        if (tag === 'alpha') return new Response(JSON.stringify({ nodes: [{ ...node('first', 'Alpha match'), nodeType: 'task', tags: ['alpha'] }] }));
        if (tag === 'beta') return new Response(JSON.stringify({ nodes: [{ ...node('second', 'Beta match'), nodeType: 'task', tags: ['beta'] }] }));
        return new Response(JSON.stringify({ nodes: [] }));
      }
      if (url === '/api/nodes/columns') return new Response(JSON.stringify({ rows: [], unavailable: [], omitted: [] }));
      throw new Error(`Unexpected request ${url}`);
    });
    const mounted = mount({
      nodes: [
        { ...node('first', 'First node'), nodeType: 'info', tags: ['alpha'] },
        { ...node('second', 'Second node'), nodeType: 'task', tags: ['beta'] },
      ],
      multiMemory: true,
      forcedView: 'nodes',
      scopeMemories: [scopeRow('first', 'First memory'), scopeRow('second', 'Second memory')],
      serverPage,
    });
    await tick(3);
    const typeMenu = [...mounted.target.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('Node Types'))!;
    typeMenu.click();
    await tick(2);
    const task = [...mounted.target.querySelectorAll('label')].find(label => label.textContent?.trim() === 'task')!.querySelector('input')!;
    task.click();
    await vi.advanceTimersByTimeAsync(350);
    await tick(3);
    expect(searchBodies().at(-1)?.filter?.nodeTypes).toEqual(['task']);

    const tagMenu = [...mounted.target.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('Tags'))!;
    tagMenu.click();
    await tick(2);
    const beta = [...mounted.target.querySelectorAll('label')].find(label => label.textContent?.trim() === 'beta')!.querySelector('input')!;
    beta.click();
    await vi.advanceTimersByTimeAsync(350);
    await tick(3);
    expect(searchBodies().at(-1)?.filter).toMatchObject({ nodeTypes: ['task'], tags: ['beta'] });

    // A server-paged browser deliberately selects ONE tag: NodeFilter.tags is
    // hasEvery, and fanning out an OR control would break global order and caps.
    const alpha = [...mounted.target.querySelectorAll('label')].find(label => label.textContent?.trim() === 'alpha')!.querySelector('input')!;
    alpha.click();
    await vi.advanceTimersByTimeAsync(350);
    await tick(3);
    expect(searchBodies().at(-1)?.filter).toMatchObject({ nodeTypes: ['task'], tags: ['alpha'] });
    expect(mounted.target.textContent).toContain('Alpha match');
    expect(mounted.target.textContent).not.toContain('Beta match');
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

describe('tree reorder on a server-paged browser (#1881)', () => {
  async function mountTree(total: number) {
    window.localStorage.setItem('hadron:memoryBrowser:nodesPane', 'tree');
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/nodes/reorder') return new Response('{}', { status: 200 });
      throw new Error(`Unexpected request ${url}`);
    });
    const mounted = mount({
      nodes: [
        { ...node('first', 'Alpha'), id: 'alpha', loc: 'alpha' },
        { ...node('first', 'Beta'), id: 'beta', loc: 'beta' },
      ],
      multiMemory: true,
      forcedView: 'nodes',
      scopeMemories: [scopeRow('first', 'First memory')],
      serverPage: { ...serverPage, total },
    });
    await tick(5);
    return mounted;
  }

  async function dragAlphaBeforeBeta(target: HTMLElement) {
    const alpha = target.querySelector<HTMLElement>('[data-node-id="alpha"]')!;
    const beta = target.querySelector<HTMLElement>('[data-node-id="beta"]')!;
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const start = new Event('dragstart', { bubbles: true });
    Object.defineProperty(start, 'dataTransfer', { value: transfer });
    alpha.dispatchEvent(start);
    beta.getBoundingClientRect = () => ({ top: 0, height: 100, left: 0, right: 100, bottom: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const over = new MouseEvent('dragover', { bubbles: true, clientY: 10 });
    Object.defineProperty(over, 'dataTransfer', { value: transfer });
    beta.dispatchEvent(over);
    beta.dispatchEvent(new Event('drop', { bubbles: true }));
    await tick(5);
  }

  it('does not renumber only the visible siblings of a larger tree', async () => {
    const mounted = await mountTree(25);
    await dragAlphaBeforeBeta(mounted.target);
    expect(fetchMock.mock.calls.filter(call => call[0] === '/api/nodes/reorder')).toEqual([]);
  });

  it('still reorders when the supplied tree is complete (control)', async () => {
    const mounted = await mountTree(2);
    await dragAlphaBeforeBeta(mounted.target);
    const calls = fetchMock.mock.calls.filter(call => call[0] === '/api/nodes/reorder');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({ memoryId: 'first' });
  });
});
