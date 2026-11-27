import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY, NODE_APPROVAL_QUERY } from '$lib/server/queries';
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
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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

async function mountPage(search = '', parent: typeof PARENT = PARENT, form: unknown = null) {
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk${search}`),
    parent: vi.fn().mockResolvedValue(parent),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...parent, ...loaded }, form });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m;
}

it.each(['APPROVED', 'SUPERSEDED'] as const)('renders server %s after metadata revisions without inferring from revision equality (#1129)', async (state) => {
  const answer = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_APPROVAL_QUERY) return { node: { id: NODE.id, revision: NODE.revision, approvalStatus: { state, approval: { revision: 3, approvedAt: '2026-10-01T00:00:00Z', approvedBy: null, approvedByInfo: 'reviewer', hash: 'abc' } } } };
    return answer(doc);
  });
  const { target } = await mountPage();
  // The detail lives in the approval icon's panel; the icon itself says the state in words.
  const badge = target.querySelector('#node-status-approval')!;
  const icon = target.querySelector('[data-testid="status-icon-approval"]')!;
  expect(icon.getAttribute('aria-label')).toBe(state === 'APPROVED' ? 'Approval: Approved' : 'Approval: Content changed since approval');
  expect(icon.getAttribute('data-look')).toBe(state === 'APPROVED' ? 'done' : 'attention');
  expect(badge.textContent).toContain('Content approved at revision 3');
  if (state === 'APPROVED') {
    expect(badge.textContent).toContain('Current revision 4');
    expect(badge.querySelector('form[action="?/approveNode"]')).toBeNull();
  } else {
    expect(badge.textContent).toContain('Content changed since approval');
    expect(badge.querySelector('form[action="?/approveNode"]')).not.toBeNull();
    expect(badge.querySelector<HTMLInputElement>('input[name="revision"]')!.value).toBe('4');
  }
});

describe('an approve outcome is said once: by the persistent announcer, not again by the panel it pins open', () => {
  const outcome = (type: 'error' | 'success', text: string) => ({
    form: { id: 'approveNode', valid: true, posted: true, errors: {}, data: { _kind: 'approveNode', revision: 4 }, message: { type, text } },
  });
  const heardAlerts = (target: HTMLElement) => [...target.querySelectorAll('[role=alert]')].filter((a) => !a.closest('[aria-hidden="true"]'));

  it('a refusal: the announcer holds the text; the panel copy is shown but hidden from assistive technology', async () => {
    const { target } = await mountPage('', PARENT, outcome('error', 'Only a decider can approve.'));
    expect(target.querySelector('[data-testid="status-outcome-announcer"]')!.textContent).toContain('Only a decider can approve.');
    const panel = target.querySelector<HTMLElement>('#node-status-approval')!;
    expect(panel.hidden).toBe(false); // pinned open to show it
    expect(panel.querySelector('[data-testid=approval-error]')!.textContent).toContain('Only a decider can approve.');
    expect(heardAlerts(target)).toEqual([]);
  });

  it('a success line: the same, so it is not read twice', async () => {
    const { target } = await mountPage('', PARENT, outcome('success', 'Revision 4 approved.'));
    expect(target.querySelector('[data-testid="status-outcome-announcer"]')!.textContent).toContain('Revision 4 approved.');
    const line = target.querySelector('#node-status-approval [data-testid=approval-success]')!;
    expect(line.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
