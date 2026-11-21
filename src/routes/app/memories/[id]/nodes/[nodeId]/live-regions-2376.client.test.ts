/**
 * portal#2376 (slice 3 of #2344): the Data and Properties tabs' "nested too deeply" notes sit in a
 * region that is mounted before they speak. Mounts the REAL node page with data from the REAL
 * loader (as `properties-tab.client.test.ts` does). Each pin is before/during/after: the region
 * EXISTS and is EMPTY, holds the text, and is the SAME element once the value is back to normal.
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null as unknown, properties: { color: 'red' } as unknown,
  objectType: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
/**
 * A stored value the page's safe serializer (`displayJson`) cannot serialize, so it answers null:
 * the same outcome as a pathologically nested value, without a 20 000-deep object that the page's
 * other effects would also have to walk.
 */
const tooDeep = () => ({ toJSON: () => { throw new Error('cannot be serialized'); } });

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
});

// `patch` is applied AFTER the real loader ran: the loader's own storage-form seed (JSON.stringify of
// the bag) cannot take a value this deep, so the page is handed it as already-loaded data.
async function open(tab: 'data' | 'properties', patch: Record<string, unknown>) {
  const node = NODE;
  setStubPage(`http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const loadedNode = (loaded as { node: Record<string, unknown> }).node;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded, node: { ...loadedNode, ...patch } }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  const button = (name: string) => [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(name))!;
  const goTo = (name: string) => () => { button(name).click(); flushSync(); };
  return { root: m.target, button, goTo };
}

// The value is unreadable as text from the moment the page loads, so the note appears when its TAB is
// opened and goes when another is: the region it speaks in must already be on the page, empty, while
// that tab is closed (which is why it sits outside the tab panel).
describe('node Data tab: the nested-too-deeply notes are in a persistent status region', () => {
  it('Rendered view: "nested too deeply to show here"', async () => {
    const { root, goTo } = await open('data', { data: tooDeep() });
    goTo('Content')();
    await expectRegionLifecycle(root, 'This node’s data is nested too deeply to show here.', goTo('Data'), goTo('Content'), () => tick());
  });

  it('Source view: "nested too deeply to show or edit as text here"', async () => {
    const { root, button, goTo } = await open('data', { data: tooDeep() });
    button('Source').click();
    flushSync();
    await tick();
    goTo('Content')();
    await expectRegionLifecycle(root, 'This node’s data is nested too deeply to show or edit as text here.', goTo('Data'), goTo('Content'), () => tick());
  });
});

describe('node Properties tab: the nested-too-deeply notes are in a persistent status region', () => {
  it('Rendered view: "nested too deeply to show here"', async () => {
    const { root, goTo } = await open('properties', { properties: tooDeep() });
    goTo('Content')();
    await expectRegionLifecycle(root, 'This node’s properties are nested too deeply to show here.', goTo('Properties'), goTo('Content'), () => tick());
  });

  it('Source view: "nested too deeply to show or edit as text here"', async () => {
    const { root, button, goTo } = await open('properties', { properties: tooDeep() });
    button('Source').click();
    flushSync();
    await tick();
    goTo('Content')();
    await expectRegionLifecycle(root, 'This node’s properties are nested too deeply to show or edit as text here.', goTo('Properties'), goTo('Content'), () => tick());
  });
});
