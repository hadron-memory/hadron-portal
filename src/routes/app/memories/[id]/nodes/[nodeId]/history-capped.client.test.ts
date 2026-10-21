/**
 * portal#1226 — the History tab says when its revision window came back full,
 * on the REAL node page with data from the REAL loader (the #995 harness
 * pattern), and the cue belongs to the node whose read set it: navigating to
 * another node, or a late answer for the node left behind, never shows or keeps
 * another node's cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
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

let revisionCount = 0;
const revisionRows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, revNo: i, nodeId: 'leaf-pk', loc: 'foo', name: 'Foo', alias: null, description: null,
  tags: [], editedBy: null, revLabel: null, changedFields: [], createdAt: '2026-10-01T00:00:00Z',
}));

beforeEach(() => {
  revisionCount = 0;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: revisionRows(revisionCount) };
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


const NOTICE = 'Showing the first';

describe('History tab full-window cue (portal#1226)', () => {
  it('says the history may be longer when the window came back full', async () => {
    revisionCount = 100;
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).toContain(`${NOTICE} 100 revisions`);
  });

  it('says nothing when the history is shorter than the window', async () => {
    revisionCount = 99;
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).not.toContain(NOTICE);
  });

  it('the cue does not follow the reader to another node, and a late answer for the old node is ignored', async () => {
    revisionCount = 100;
    const m = await mountPage('?tab=history');
    expect(m.target.textContent).toContain(NOTICE);

    const data = m.props.data as Record<string, unknown>;
    const oldNode = data.node as Record<string, unknown>;
    // Node A's read is still in flight when the reader moves on.
    let answerA!: (v: unknown) => void;
    m.props.data = { ...data, revisions: new Promise((r) => { answerA = r; }) };
    await settle();
    // Node B's short history resolves first.
    m.props.data = {
      ...data,
      node: { ...oldNode, id: 'other-pk', loc: 'bar' },
      revisions: Promise.resolve({ ok: true, items: revisionRows(2), capped: false, nodeId: 'other-pk' }),
    };
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);

    // Node A's capped answer arrives late.
    answerA({ ok: true, items: revisionRows(100), capped: true, nodeId: 'leaf-pk' });
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);
  });
});
