/**
 * portal#1355 — the History tab shows the edge-removal audit entries a hard
 * delete left on this node (server#2562, hrn:node:hadronmemory.com:specs:cor:dmo:010:04), on the REAL node
 * page with data from the REAL loader (the #995 harness pattern). The entries
 * are deliberately NOT revisions, so they render as their own list under the
 * revisions table; a withheld cross-memory loc renders as absent-with-a-reason,
 * never as an empty value, and a failed read says so instead of hiding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_EDGE_REMOVALS_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
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

const removal = (over: Partial<Record<string, string | null>> = {}) => ({
  id: 'rm1', edgeLoc: 'foo:to-tgt', edgeName: 'depends_on',
  targetId: 'tgt-pk', targetLoc: 'tgt',
  reason: 'TARGET_HARD_DELETED', removedBy: 'user-9',
  createdAt: new Date(2026, 9, 19, 13, 4, 5).toISOString(),
  ...over,
});

let removalRows: Array<ReturnType<typeof removal>> = [];
let removalsFail = false;

beforeEach(() => {
  removalRows = [];
  removalsFail = false;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    if (doc === NODE_EDGE_REMOVALS_QUERY) {
      if (removalsFail) throw new Error('gql down');
      return { nodeEdgeRemovals: removalRows };
    }
    if (doc === COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
    if (doc === NODE_COMMENT_SUMMARY_QUERY) {
      return { node: { id: 'leaf-pk', revision: 4, memory: { id: 'mem-A', urn: PARENT.graph.urn }, commentSummary: { openThreads: 0, resolvedThreads: 0, comments: 0, viewerOpenThreadId: null } } };
    }
    if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
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
  return m;
}

const SECTION = 'Removed edges';
const FAILED = "Couldn't load the removed-edges audit";

describe('History tab edge-removal audit (portal#1355)', () => {
  it('renders an entry: edge, target, reason, actor and date', async () => {
    removalRows = [removal()];
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).toContain(SECTION);
    expect(target.textContent).toContain('foo:to-tgt');   // the removed edge's loc
    expect(target.textContent).toContain('depends_on');   // its name
    expect(target.textContent).toContain('tgt');          // the deleted target's loc
    expect(target.textContent).toContain('Target was hard-deleted'); // reason, human words
    expect(target.textContent).toContain('user-9');       // who deleted
    expect(target.textContent).toContain('Oct 19, 2026, 1:04:05 PM');
  });

  it('a withheld cross-memory loc renders absent, not empty — and the target id still shows', async () => {
    removalRows = [removal({ edgeLoc: null, targetLoc: null })];
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).toContain(SECTION);
    expect(target.textContent).toContain('tgt-pk');       // stable id is always shown
    expect(target.textContent).toContain("can't read"); // why no loc appears
    expect(target.textContent).not.toContain('foo:to-tgt');
  });

  it('no entries → the section stays hidden (nothing to say, unlike a failure)', async () => {
    removalRows = [];
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).not.toContain(SECTION);
    expect(target.textContent).not.toContain(FAILED);
  });

  it('a failed read says so — it is not the same as none recorded', async () => {
    removalsFail = true;
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).toContain(SECTION);
    expect(target.textContent).toContain(FAILED);
  });

  it('a full window says it may be longer (hadron-server#2211 pattern)', async () => {
    removalRows = Array.from({ length: 100 }, (_, i) => removal({ id: `rm${i}` }));
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).toContain('Showing the first 100');
  });

  it('previous entries vanish while the replacement promise is pending', async () => {
    removalRows = [removal()];
    const m = await mountPage('?tab=history');
    expect(m.target.textContent).toContain('foo:to-tgt');
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, edgeRemovals: new Promise(() => {}) };
    await settle();
    expect(m.target.textContent).not.toContain('foo:to-tgt');
    expect(m.target.textContent).not.toContain(SECTION);
  });

  it('a stale failure does not linger while the replacement promise is pending', async () => {
    removalsFail = true;
    const m = await mountPage('?tab=history');
    expect(m.target.textContent).toContain(FAILED);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, edgeRemovals: new Promise(() => {}) };
    await settle();
    expect(m.target.textContent).not.toContain(FAILED);
  });

  it('a late answer for a node the reader left never lands on the current one', async () => {
    removalRows = [removal()];
    const m = await mountPage('?tab=history');
    expect(m.target.textContent).toContain('foo:to-tgt');

    const data = m.props.data as Record<string, unknown>;
    let stale!: (v: unknown) => void;
    m.props.data = { ...data, edgeRemovals: new Promise((r) => { stale = r; }) };
    await settle();
    m.props.data = { ...data, edgeRemovals: Promise.resolve({ ok: true, items: [] }) };
    await settle();
    stale({ ok: true, items: [removal({ edgeLoc: 'late:answer' })] });
    await settle();
    expect(m.target.textContent).not.toContain('late:answer');
  });
});

describe('comment nodes read no removals (portal#1355)', () => {
  it('the loader resolves empty without asking the server', async () => {
    const commentNode = { ...NODE, nodeType: 'comment' };
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: commentNode };
      if (doc === NODE_REVISIONS_PAGE_QUERY || doc === NODE_EDGE_REMOVALS_QUERY) {
        throw new Error('must not be asked');
      }
      if (doc === COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
      if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
      return { memories: { items: [], total: 0 }, node: null };
    });
    const loaded = (await load({
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
      url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=history'),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as Record<string, unknown>;
    expect(await (loaded.edgeRemovals as Promise<{ ok: boolean; items: unknown[] }>)).toEqual({ ok: true, items: [] });
    const asked = mockRequest.mock.calls.some((c) => c[0] === NODE_EDGE_REMOVALS_QUERY);
    expect(asked).toBe(false);
  });
});
