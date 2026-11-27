/**
 * portal#2673 items 3 and 5: on a question page the approve result renders in exactly one place. With the card
 * showing it is the card's row; with the card not showing (read failed) it falls back to the page's own row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY, NODE_APPROVAL_QUERY } from '$lib/server/queries';
import { QUESTION_BY_REF_QUERY } from '$lib/server/queries';
import { COMMENT_THREADS_QUERY, NODE_COMMENT_SUMMARY_QUERY, SELF_MEMORY_ACCESS_QUERY } from '$lib/server/comments';
// Static imports: the page is large (see form-ids.client.test.ts).
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  role: 'question',
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

async function mountPage(form: unknown, search = '', parent: typeof PARENT = PARENT) {
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


const QUESTION = {
  id: 'q-1', urn: 'hrn:node:acme.com:m:q', portalUrl: null, code: 'Q1', title: 'Which?', background: null, whyNow: null, priority: 'NORMAL',
  tier: 'APPROVED', authorizes: false, state: 'ANSWERED_UNCONFIRMED', answered: true, revSeq: 4, viewerIsDecider: true, viewerMayAnswer: true,
  neededBy: null, defaultAction: null, askedAt: '2026-11-18T10:00:00Z', answeredAt: '2026-11-18T11:00:00Z', options: [],
  recommendation: null, noRecommendationReason: null, answer: null, answers: [], blocks: [], sources: [], specsTouched: [], specsMustChange: [],
  deciders: [], assignee: null, effectiveAssignee: null, askedBy: null, withdrawn: null,
};
function serve(question: unknown) {
  const base = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === QUESTION_BY_REF_QUERY) return { question };
    if (doc === NODE_APPROVAL_QUERY) return { node: { id: NODE.id, revision: NODE.revision, approvalStatus: { state: 'NOT_APPROVED', approval: null } } };
    return base(doc);
  });
}
const approveForm = (message: { type: 'error' | 'success'; text: string }) => ({
  form: { id: 'approveNode', valid: true, posted: true, errors: {}, data: { _kind: 'approveNode', revision: 4 }, message },
});
const alertsWithText = (target: HTMLElement) => [...target.querySelectorAll('[role=alert]')].filter((a) => (a.textContent ?? '').includes('Only a decider can approve.'));

describe('portal#2665/#2673: the approve result on a question page', () => {
  it('card showing: the refusal renders once, in the card, never in the page row (item 5)', async () => {
    serve(QUESTION);
    const { target } = await mountPage(approveForm({ type: 'error', text: 'Only a decider can approve.' }));
    expect(target.querySelector('[data-testid=question-approval-error]')!.textContent).toBe('Only a decider can approve.');
    expect(target.querySelector('[data-testid=approval-error]')).toBeNull();
    expect(alertsWithText(target)).toHaveLength(1);
  });
  it('card not showing: the page renders the refusal in its own row (item 3)', async () => {
    serve(null);
    const { target } = await mountPage(approveForm({ type: 'error', text: 'Only a decider can approve.' }));
    expect(target.querySelector('[data-testid=question-read-failed]')).not.toBeNull();
    expect(target.querySelector('[data-testid=question-approval-error]')).toBeNull();
    expect(target.querySelector('[data-testid=approval-error]')!.textContent).toContain('Only a decider can approve.');
    expect(alertsWithText(target)).toHaveLength(1);
  });
  it('card not showing: the page renders the success line in its own row (item 3)', async () => {
    serve(null);
    const { target } = await mountPage(approveForm({ type: 'success', text: 'Revision 4 approved.' }));
    expect(target.querySelector('[data-testid=question-approval-success]')).toBeNull();
    expect(target.querySelector('[data-testid=approval-success]')!.textContent).toContain('Revision 4 approved.');
  });
});
