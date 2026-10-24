/**
 * portal#1142 S2b — a History restore the server refuses for an include tag
 * (hadron-server#2226), on the REAL node page with data from the REAL loader
 * (the #995 harness pattern, as in history-capped.client.test.ts). The
 * endpoint answers 409 with the refusal text; the dialog stays open and shows
 * it as an alert, escaped, with no reload and no success. Pinned both ways: a
 * 200 closes the dialog and reloads.
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


import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';

const REFUSAL = 'Include <b>t</b> names a node you cannot read. Tag: <img src=x onerror=alert(1)>{{> t}}. Nothing was restored, and the node is unchanged. That revision has an include tag you can’t add now.';

async function openRestoreDialog() {
  revisionCount = 2;
  const m = await mountPage('?tab=history');
  const menu = m.target.querySelector<HTMLButtonElement>('button[aria-label="Revision actions"]');
  expect(menu).not.toBeNull();
  menu!.click();
  await settle();
  const restore = [...m.target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === 'Restore');
  expect(restore?.disabled).toBe(false);
  restore!.click();
  await settle();
  expect(m.target.textContent).toContain('Restore this revision?');
  return m;
}

function confirmButton(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Restore' && !b.getAttribute('role'))!;
}

describe('History restore refused for an include tag (portal#1142 S2b)', () => {
  beforeEach(() => resetNavigationCalls());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the dialog open with the refusal as an escaped alert, and reloads nothing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: REFUSAL, code: 'INCLUDE_TARGET_UNAVAILABLE' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const m = await openRestoreDialog();
    confirmButton(m.target).click();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('/app/memories/mem-A/nodes/leaf-pk/revisions', expect.objectContaining({ method: 'POST' }));
    expect(m.target.textContent).toContain('Restore this revision?');
    const alert = m.target.querySelector('[data-testid="restore-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toBe(REFUSAL);
    expect(alert?.querySelector('img, b')).toBeNull();
    expect(m.target.querySelector('img[src="x"]')).toBeNull();
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
  });

  it('control: a successful restore closes the dialog and reloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const m = await openRestoreDialog();
    confirmButton(m.target).click();
    await settle();
    expect(m.target.textContent).not.toContain('Restore this revision?');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
  });
});
