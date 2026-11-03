/**
 * portal#1656: the node page's Children section shows one page of 20 direct
 * children, in the server's sibling order, and asks for the next 20 only when
 * the user presses "Show more". A short page is never presented as the whole
 * list: the tab count says "20+" and Reorder (which rewrites the order of every
 * row it is given) waits until the list is complete.
 *
 * Mounts the REAL page, as properties-tab.client.test.ts does; the next page is
 * read through `fetch` on the section's own endpoint, stubbed here.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: null, abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, objectType: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const row = (loc: string, seq: number | null = null) => ({
  id: `id-${loc}`, memoryId: 'mem-A', loc: `foo:${loc}`, name: `N-${loc}.`, description: null,
  nodeType: 'info', tags: [], seq, isRunnable: null, openThreads: 0,
});
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row(`c${String(from + i).padStart(2, '0')}`));

type Answer = { children: unknown[]; hasMore: boolean } | { failed: true } | { reject: Error };
let calls: string[] = [];
let answer: Answer = { children: [], hasMore: false };
let held: Promise<void> | null = null;

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  calls = [];
  held = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const mine = answer;
    const wait = held;
    held = null;
    await wait;
    if ('reject' in mine) throw mine.reject;
    return new Response(JSON.stringify(mine), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=children', { id: 'mem-A', nodeId: 'leaf-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
});

async function mountPage(children: unknown[] | null, childrenHasMore: boolean) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [], nodeBatch: { nodes: [], unavailable: [], omitted: [], truncated: false }, findNodes: { total: null, hits: [] } };
  });
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=children'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const data = { ...PARENT, ...loaded, children, childrenHasMore, childrenUnavailable: children === null };
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  const tab = Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('Children'));
  tab?.click();
  await tick();
  flushSync();
  return { ...m, props, tab };
}

const shownLocs = (target: HTMLElement) =>
  Array.from(target.querySelectorAll('tbody tr')).map((tr) => tr.textContent?.match(/N-([^.]+)\./)?.[1]).filter(Boolean);
const showMore = (target: HTMLElement) => target.querySelector<HTMLButtonElement>('[data-testid="children-show-more"]');
const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); flushSync(); } };

it("shows the children in the server's order and never re-sorts them", async () => {
  // Not the old client order (positioned by seq, then loc): if the server's
  // sibling-order ruling changes, the page follows it.
  const { target } = await mountPage([row('b'), row('a'), row('z', 2), row('y', 1)], false);
  expect(shownLocs(target)).toEqual(['b', 'a', 'z', 'y']);
});

it('a complete page shows its count and no "Show more"', async () => {
  const { target, tab } = await mountPage(rows(20), false);
  expect(tab!.textContent).toMatch(/Children\s*20$/);
  expect(showMore(target)).toBeNull();
});

it('a page with more says "20+" and offers "Show more", never a bare 20', async () => {
  const { target, tab } = await mountPage(rows(20), true);
  expect(tab!.textContent).toMatch(/Children\s*20\+$/);
  expect(showMore(target)).not.toBeNull();
});

it('"Show more" asks the section endpoint for offset 20 and appends the next page', async () => {
  const { target, tab } = await mountPage(rows(20), true);
  answer = { children: rows(20, 20), hasMore: true };
  showMore(target)!.click();
  await settle();
  expect(calls).toEqual(['/app/memories/mem-A/nodes/leaf-pk/children?offset=20']);
  // The table pages its rows itself (25 a page), so the count is the tab's.
  expect(shownLocs(target)).toContain('c20');
  expect(tab!.textContent).toMatch(/Children\s*40\+$/);

  answer = { children: rows(3, 40), hasMore: false };
  showMore(target)!.click();
  await settle();
  expect(calls[1]).toBe('/app/memories/mem-A/nodes/leaf-pk/children?offset=40');
  expect(tab!.textContent).toMatch(/Children\s*43$/);
  expect(showMore(target)).toBeNull();
});

it.each<[string, Answer]>([
  ['a failed read', { failed: true }],
  ['a rejected fetch', { reject: new Error('offline') }],
])('%s keeps the rows, says so, and leaves "Show more" to retry', async (_label, failure) => {
  const { target, tab } = await mountPage(rows(20), true);
  answer = failure;
  showMore(target)!.click();
  await settle();
  expect(shownLocs(target)).toHaveLength(20);
  expect(target.querySelector('[data-testid="children-more-failed"]')).not.toBeNull();
  expect(tab!.textContent).toMatch(/Children\s*20\+$/);
  expect(showMore(target)).not.toBeNull();

  answer = { children: rows(1, 20), hasMore: false };
  showMore(target)!.click();
  await settle();
  expect(shownLocs(target)).toHaveLength(21);
  expect(target.querySelector('[data-testid="children-more-failed"]')).toBeNull();
});

it('a second press while a page is loading asks nothing more', async () => {
  const { target } = await mountPage(rows(20), true);
  answer = { children: rows(20, 20), hasMore: true };
  let release!: () => void;
  held = new Promise<void>((r) => (release = r));
  showMore(target)!.click();
  await settle();
  expect(showMore(target)!.disabled).toBe(true);
  showMore(target)!.click();
  release();
  await settle();
  expect(calls).toHaveLength(1);
  expect(shownLocs(target)).toContain('c20');
});

it('Reorder is not offered while more children exist (it would renumber only the rows shown)', async () => {
  const positioned = rows(20).map((r, i) => ({ ...r, seq: i + 1 }));
  const reorder = (t: HTMLElement) => Array.from(t.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reorder');
  const partial = await mountPage(positioned, true);
  expect(reorder(partial.target)).toBeUndefined();
  const complete = await mountPage(positioned, false);
  expect(reorder(complete.target)).not.toBeUndefined();
});

it('new page data (a reload) replaces the pages read before it', async () => {
  const { target, props } = await mountPage(rows(20), true);
  answer = { children: rows(20, 20), hasMore: true };
  showMore(target)!.click();
  await settle();
  expect(shownLocs(target)).toContain('c20');
  flushSync(() => { props.data = { ...(props.data as Record<string, unknown>), children: rows(5, 100), childrenHasMore: false }; });
  await settle();
  expect(shownLocs(target)).toEqual(rows(5, 100).map((r) => r.loc.slice(4)));
});

it('a page that lands after the page data changed is dropped', async () => {
  const { target, props } = await mountPage(rows(20), true);
  answer = { children: rows(20, 20), hasMore: true };
  let release!: () => void;
  held = new Promise<void>((r) => (release = r));
  showMore(target)!.click();
  await settle();
  flushSync(() => { props.data = { ...(props.data as Record<string, unknown>), children: rows(2, 100), childrenHasMore: false }; });
  release();
  await settle();
  expect(shownLocs(target)).toEqual(['c100', 'c101']);
});
