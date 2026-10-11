/**
 * portal#1014 — the Discussion tab on the REAL node page, with data from the
 * REAL loader (the #995 harness pattern):
 *
 * - Cloe's QA on #1024: a cold load with `?tab=discussion` must open the tab.
 *   The node-change reset runs once on mount, after the effect that marks the
 *   tab opened, and it used to clear that mark while activeTab stayed put.
 * - The local review's P2-1 on #1024: a draft survives switching tabs, because
 *   the tab stays mounted (hidden) once opened.
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

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
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

async function mountPage(search = '') {
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk${search}`),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m;
}

const panel = (t: HTMLElement) => t.querySelector<HTMLElement>('[data-testid="discussion-panel"]');
const tabButton = (t: HTMLElement, label: string) =>
  [...t.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(label));

describe('Discussion tab on the node page (portal#1014)', () => {
  it('a comment node offers no Revisions tab or history even with a history deep link', async () => {
    const answer = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: { ...NODE, nodeType: 'comment' } };
      return answer(doc);
    });
    const { target } = await mountPage('?tab=history');
    expect(tabButton(target, 'Revisions')).toBeUndefined();
    expect(target.textContent).not.toContain('A snapshot is saved each time');
    expect(mockRequest.mock.calls.filter(([doc]) => doc === NODE_REVISIONS_QUERY)).toHaveLength(0);
  });

  it("Cloe's QA on #1024: a cold load with ?tab=discussion opens the tab", async () => {
    const { target } = await mountPage('?tab=discussion');
    const p = panel(target);
    expect(p).not.toBeNull();
    expect(p!.hidden).toBe(false);
    expect(target.querySelector('#new-comment')).not.toBeNull();
  });

  it('without the deep link, the tab is not opened (Content is the default)', async () => {
    const { target } = await mountPage();
    expect(panel(target)).toBeNull();
  });

  it('local review on #1024, P2-1: a draft survives switching to Content and back', async () => {
    const { target } = await mountPage();
    tabButton(target, 'Discussion')!.click();
    await settle();
    const box = target.querySelector<HTMLTextAreaElement>('#new-comment')!;
    box.value = 'Half-written';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    tabButton(target, 'Content')!.click();
    await settle();
    expect(panel(target)!.hidden).toBe(true);

    tabButton(target, 'Discussion')!.click();
    await settle();
    expect(panel(target)!.hidden).toBe(false);
    expect(target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('Half-written');
  });
});
