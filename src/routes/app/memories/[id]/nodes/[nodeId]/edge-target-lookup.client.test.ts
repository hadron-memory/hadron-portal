/**
 * portal#1524 — adding an edge target resolves the typed loc with one async
 * per-node read (/api/nodes/resolve). Pins the editor around that wait: pending,
 * failed vs not-found, a duplicate, and an editor closed or reopened while the
 * answer is in flight (a late answer must not land in a stale editor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import { COMMENT_THREADS_QUERY, NODE_COMMENT_SUMMARY_QUERY, SELF_MEMORY_ACCESS_QUERY } from '$lib/server/comments';
// Static imports: the page is large (see form-ids.client.test.ts).
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', appId: null },
};
// A `knowledge` memory takes comments (hrn:node:hadronmemory.com:specs:cor:dmo:110:02).
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};


beforeEach(() => {
  currentNode = NODE;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: currentNode };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    if (doc === COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
    if (doc === NODE_COMMENT_SUMMARY_QUERY) {
      return { node: { id: 'leaf-pk', revision: 4, memory: { id: 'mem-A', urn: PARENT.graph.urn }, commentSummary: { openThreads: 0, resolvedThreads: 0, comments: 0, viewerOpenThreadId: null } } };
    }
    if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});
let currentNode: typeof NODE = NODE;
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

async function loadNode(nodeId: string, parent: typeof PARENT = PARENT) {
  const loaded = (await load({
    params: { id: 'mem-A', nodeId },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/${nodeId}?tab=references`),
    parent: vi.fn().mockResolvedValue(parent),
  } as never)) as Record<string, unknown>;
  return { ...parent, ...loaded };
}

async function mountPage(search = '', parent: typeof PARENT = PARENT) {
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk${search}`),
    parent: vi.fn().mockResolvedValue(parent),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...parent, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return Object.assign(m, { props });
}


const TGT = { id: 'tgt-pk', loc: 'tgt', name: 'Zed Resolved' };
type Resolver = (r: Response | Error) => void;
let pending: Resolver[] = [];
const urls: string[] = [];
beforeEach(() => {
  pending = [];
  urls.length = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    urls.push(String(url));
    return new Promise<Response>((resolve, reject) => {
      pending.push((r) => (r instanceof Error ? reject(r) : resolve(r)));
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const byText = (t: HTMLElement, sel: string, text: string) =>
  [...t.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text);
async function openEditor(target: HTMLElement) {
  byText(target, 'button', 'Edit edges')!.click();
  await settle();
}
async function typeAndAdd(target: HTMLElement, q: string) {
  const input = target.querySelector<HTMLInputElement>('#newEdgeTarget')!;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  byText(target, 'button', '+ Add')!.click();
  await settle();
}

describe('edge target lookup in the edge editor (portal#1524)', () => {
  it('a found target is added once; a second click while pending sends no second lookup', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    await typeAndAdd(target, 'tgt');
    byText(target, 'button', '+ Add')!.click();
    await settle();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/nodes/resolve?memoryId=mem-A&ref=tgt');
    pending[0](json({ found: true, node: TGT }));
    await settle();
    expect(target.textContent!.split('Zed Resolved')).toHaveLength(2); // exactly one row
    expect(target.textContent).not.toContain('No node found');
    // the same target again is refused as a duplicate, not added twice
    await typeAndAdd(target, 'tgt');
    pending[1](json({ found: true, node: TGT }));
    await settle();
    expect(target.textContent).toContain('That edge already exists');
    expect(target.textContent!.split('Zed Resolved')).toHaveLength(2);
  });

  it('a not-found answer names the target that was looked up, not a later edit of the field', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    await typeAndAdd(target, 'old-missing');
    const input = target.querySelector<HTMLInputElement>('#newEdgeTarget')!;
    input.value = 'new-existing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    pending[0](json({ found: false }));
    await settle();
    expect(target.textContent).toContain('No node found matching "old-missing"');
    expect(target.textContent).not.toContain('matching "new-existing"');
    expect(input.value).toBe('new-existing');
  });

  it('a not-found answer says so; a failed lookup says it failed (not "no node")', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    await typeAndAdd(target, 'nope');
    pending[0](json({ found: false }));
    await settle();
    expect(target.textContent).toContain('No node found matching "nope"');
    await typeAndAdd(target, 'nope');
    pending[1](new Response('x', { status: 500 }));
    await settle();
    expect(target.textContent).toContain('Could not look that node up');
    expect(target.textContent).not.toContain('No node found matching "nope"');
  });

  it('closing the editor while a lookup is pending drops the late answer', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    await typeAndAdd(target, 'tgt');
    byText(target, 'button', 'Cancel')!.click();
    await settle();
    await openEditor(target);
    pending[0](json({ found: true, node: TGT }));
    await settle();
    expect(target.textContent).not.toContain('Zed Resolved');
    expect(target.textContent).not.toContain('No node found');
    // the reopened editor is not stuck waiting on the dead lookup
    await typeAndAdd(target, 'tgt');
    expect(urls).toHaveLength(2);
  });

  it('a late FAILURE from a closed editor shows no error in the next one', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    await typeAndAdd(target, 'tgt');
    byText(target, 'button', 'Cancel')!.click();
    await settle();
    await openEditor(target);
    pending[0](new Error('network'));
    await settle();
    expect(target.textContent).not.toContain('Could not look that node up');
  });

  it('navigating to another node while a lookup is pending drops the late answer (A to B)', async () => {
    const m = await mountPage('?tab=references');
    const { target } = m;
    await openEditor(target);
    await typeAndAdd(target, 'tgt');
    currentNode = { ...NODE, id: 'leaf-b', loc: 'bar', name: 'Bar' };
    m.props.data = await loadNode('leaf-b');
    await settle();
    await openEditor(target);
    pending[0](json({ found: true, node: TGT }));
    await settle();
    expect(target.textContent).not.toContain('Zed Resolved');
    const hidden = [...target.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => i.value).join('|');
    expect(hidden).not.toContain('tgt-pk');
    // and the new editor is not stuck busy
    await typeAndAdd(target, 'tgt');
    expect(urls).toHaveLength(2);
    pending[1](json({ found: true, node: TGT }));
    await settle();
    expect(target.textContent).toContain('Zed Resolved');
  });

  it('the edge name sent is the one typed at submit, not a later edit', async () => {
    const { target } = await mountPage('?tab=references');
    await openEditor(target);
    const nameInput = target.querySelector<HTMLInputElement>('#newEdgeName')!;
    nameInput.value = 'cites';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await typeAndAdd(target, 'tgt');
    nameInput.value = 'changed';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    pending[0](json({ found: true, node: TGT }));
    await settle();
    const hidden = [...target.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => i.value).join('|');
    expect(hidden).toContain('cites');
    expect(hidden).not.toContain('changed');
    expect(nameInput.value).toBe('changed'); // what the reader typed meanwhile is kept
  });
});
