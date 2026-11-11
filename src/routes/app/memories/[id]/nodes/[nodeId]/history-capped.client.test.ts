/**
 * portal#1881 — the History tab pages revisions on the REAL node page with
 * data from the REAL loader (the #995 harness pattern). Page navigation belongs
 * to the node whose read produced it: navigating to another node, or a late
 * answer for the node left behind, never shows or keeps another node's pages.
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

let revisionCount = 0;
let revisionCreatedAt = '2026-10-01T00:00:00Z';
const revisionRows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, revNo: i, nodeId: 'leaf-pk', loc: 'foo', name: 'Foo', alias: null, description: null,
  tags: [], editedBy: null, revLabel: null, changedFields: [], createdAt: revisionCreatedAt,
}));
const resolvedRevisions = (nodeId: string, count = 20, total = 100) => ({
  ok: true,
  items: revisionRows(count),
  total,
  hasMore: count < total,
  nodeId,
  page: {
    offset: 0, count, total, firstHref: null, previousHref: null,
    nextHref: count < total ? '/app/memories/mem-A/nodes/leaf-pk?tab=history&revisionsOffset=20' : null,
  },
});

beforeEach(() => {
  revisionCount = 0;
  revisionCreatedAt = '2026-10-01T00:00:00Z';
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown> = {}) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) {
      const offset = Number(vars.offset ?? 0);
      const limit = Number(vars.limit ?? 20);
      return { nodeRevisionsPage: {
        items: revisionRows(revisionCount).slice(offset, offset + limit),
        total: revisionCount,
        hasMore: offset + limit < revisionCount,
      } };
    }
    if (doc === COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
    if (doc === NODE_COMMENT_SUMMARY_QUERY) {
      return { node: { id: 'leaf-pk', revision: 4, memory: { id: 'mem-A', urn: PARENT.graph.urn }, commentSummary: { openThreads: 0, resolvedThreads: 0, comments: 0, viewerOpenThreadId: null } } };
    }
    if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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

describe('History tab paging (portal#1881)', () => {
  it('links to older revisions without a capped notice', async () => {
    revisionCount = 100;
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).not.toContain(NOTICE);
    expect(target.querySelector('[data-testid="table-footer"]')).toBeNull();
    expect(target.querySelector<HTMLAnchorElement>('nav[aria-label="Revision pages"] a[rel="next"]')?.getAttribute('href')).toContain('revisionsOffset=20');
  });

  it('has no continuation or capped notice when every revision fits one page', async () => {
    revisionCount = 19;
    const { target } = await mountPage('?tab=history');
    expect(target.textContent).not.toContain(NOTICE);
    expect(target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).toBeNull();
  });

  it('page navigation does not follow the reader to another node, and a late answer for the old node is ignored', async () => {
    revisionCount = 100;
    const m = await mountPage('?tab=history');
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).not.toBeNull();

    const data = m.props.data as Record<string, unknown>;
    const oldNode = data.node as Record<string, unknown>;
    // Node A's read is still in flight when the reader moves on.
    let answerA!: (v: unknown) => void;
    m.props.data = { ...data, revisions: new Promise((r) => { answerA = r; }) };
    await settle();
    expect(m.target.querySelectorAll('button[aria-label="Revision actions"]')).toHaveLength(0);
    expect(m.target.querySelector('nav[aria-label="Revision pages"]')).toBeNull();
    // Node B's short history resolves first.
    m.props.data = {
      ...data,
      node: { ...oldNode, id: 'other-pk', loc: 'bar' },
      revisions: Promise.resolve(resolvedRevisions('other-pk', 2, 2)),
    };
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).toBeNull();

    // Node A's paged answer arrives late.
    answerA(resolvedRevisions('leaf-pk'));
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).toBeNull();
  });

  // Each guard alone, so deleting either one is caught (Glen/Gizelle, P3).
  it('the node pin alone: moving to another node on the SAME promise never shows the old page navigation', async () => {
    revisionCount = 100;
    const m = await mountPage('?tab=history');
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).not.toBeNull();
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, node: { ...(data.node as Record<string, unknown>), id: 'other-pk', loc: 'bar' } };
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).toBeNull();
  });

  it('the promise guard alone: a superseded promise that names the CURRENT node cannot set page navigation', async () => {
    revisionCount = 0;
    const m = await mountPage('?tab=history');
    const data = m.props.data as Record<string, unknown>;
    let stale!: (v: unknown) => void;
    m.props.data = { ...data, revisions: new Promise((r) => { stale = r; }) };
    await settle();
    m.props.data = { ...data, revisions: Promise.resolve(resolvedRevisions('leaf-pk', 2, 2)) };
    await settle();
    stale(resolvedRevisions('leaf-pk'));
    await settle();
    expect(m.target.textContent).not.toContain(NOTICE);
    expect(m.target.querySelector('nav[aria-label="Revision pages"] a[rel="next"]')).toBeNull();
  });
});

it('renders History timestamps with the Info date style and retains seconds (#1167)', async () => {
  revisionCount = 1;
  revisionCreatedAt = new Date(2026, 9, 19, 13, 4, 5).toISOString();
  await mountPage('?tab=history');
  expect(document.body.textContent).toContain('Oct 19, 2026, 1:04:05 PM');
});

it('matches both the displayed History timestamp and its raw wire value (#1167)', async () => {
  revisionCount = 1;
  revisionCreatedAt = new Date(2026, 9, 19, 13, 4, 5).toISOString();
  const m = await mountPage('?tab=history');
  const search = m.target.querySelector<HTMLInputElement>('input[aria-label="Search history…"]')!;
  expect(search).not.toBeNull();
  for (const query of ['Oct 19, 2026, 1:04:05 PM', revisionCreatedAt]) {
    search.value = query;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(m.target.querySelectorAll('button[aria-label="Revision actions"]')).toHaveLength(1);
  }
});

it('uses the same timestamp in the restore confirmation without restoring (#1167)', async () => {
  revisionCount = 1;
  revisionCreatedAt = new Date(2026, 9, 19, 13, 4, 5).toISOString();
  const m = await mountPage('?tab=history');
  m.target.querySelector<HTMLButtonElement>('button[aria-label="Revision actions"]')!.click();
  await settle();
  const restore = [...m.target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.trim() === 'Restore')!;
  expect(restore.disabled).toBe(false);
  restore.click();
  await settle();
  const heading = [...m.target.querySelectorAll('h3')].find(h => h.textContent === 'Restore this revision?')!;
  expect(heading.parentElement!.textContent).toContain('Oct 19, 2026, 1:04:05 PM');
});
