/**
 * portal#1724 — the History grid's Validation column on the REAL node page with
 * data from the REAL loader (the history-capped harness): a revision with a report
 * shows its time, task revision and author check under the badge; a revision
 * without one shows the badge alone; the column is wide enough for both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY, NODE_REVISIONS_PROVENANCE_PAGE_QUERY } from '$lib/server/queries';
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

let provenance: unknown[] = [];
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
  provenance = [];
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
    if (doc === NODE_REVISIONS_PROVENANCE_PAGE_QUERY) return { nodeRevisionsPage: { items: provenance } };
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



const AT = '2026-10-19T13:04:05Z';
const VALIDATOR = 'hrn:node:acme.com:ops:tasks:check-spec';
const prov = (id: string, revNo: number, contentValidation: unknown) => ({
  id, revNo, authorship: null, contentValidation,
});
const reported = (authorCheck: string | null, over: Record<string, unknown> = {}) => ({
  state: 'PASS',
  latestReport: { authorCheck, nodeRevision: 1, validationTaskRef: VALIDATOR, validationTaskRevision: 2, outcome: 'PASS', reportedAt: AT, ...over },
});
const detailOf = (row: Element) => row.querySelector('[data-testid="history-validation-detail"]');

describe('History Validation column (portal#1724)', () => {
  it('a revision with a report shows time, task revision and the author check; one without shows the badge alone', async () => {
    revisionCount = 3;
    provenance = [
      prov('r0', 0, reported('CHECKED')),
      prov('r1', 1, reported('AUTHOR_UNKNOWN', { nodeRevision: 1 })),
      prov('r2', 2, { state: 'UNVALIDATED', latestReport: null }),
    ];
    const { target } = await mountPage('?tab=history');
    const cells = [...target.querySelectorAll('[data-testid="validation-state"]')].map((b) => b.closest('td')!);
    expect(cells).toHaveLength(3);
    expect(detailOf(cells[0])!.textContent).toBe('Oct 19, 2026, 1:04:05 PM \u00b7 task revision 2 \u00b7 Author compared and differs');
    expect(detailOf(cells[1])!.textContent).toContain('Author not compared');
    expect(detailOf(cells[2])).toBeNull();
    expect(cells[2].textContent).toContain('Not validated');
    // the compact cell never carries the badge's own long lines
    expect(target.querySelector('[data-testid="validation-author-check"]')).toBeNull();
    expect(target.querySelector('[data-testid="validation-detail"]')).toBeNull();
  });

  it('a report recorded before the author check existed shows no author text', async () => {
    revisionCount = 1;
    provenance = [prov('r0', 0, reported(null))];
    const { target } = await mountPage('?tab=history');
    const detail = detailOf(target)!.textContent!;
    expect(detail).toContain('task revision 2');
    expect(detail).not.toContain('Author');
  });

  it('the Validation column is wide enough for the report line', async () => {
    revisionCount = 1;
    provenance = [prov('r0', 0, reported('CHECKED'))];
    const { target } = await mountPage('?tab=history');
    const th = [...target.querySelectorAll('th')].find((h) => h.textContent?.trim() === 'Validation') as HTMLElement;
    expect(th).toBeDefined();
    expect(th.getAttribute('style')).toContain('--col-w: 260px');
  });

  it('asks the server for the author check on every History row', () => {
    const doc = NODE_REVISIONS_PROVENANCE_PAGE_QUERY;
    expect(doc).toMatch(/latestReport\s*\{[^}]*\bauthorCheck\b/);
  });
});
