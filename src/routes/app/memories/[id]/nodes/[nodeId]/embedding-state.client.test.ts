import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const TARGET = { id: 'tgt-pk', name: 'Target node', nodeType: 'info', urn: 'hrn:node:acme.com:mem-a:target' };
const COMMENT = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'A comment', revision: 4,
  nodeType: 'comment', alias: null, description: null, content: 'the comment body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', appId: null },
  asComment: { id: 'c1', deleted: false, viewerIsAuthor: true, revSeq: 3, target: TARGET },
};
const PLAIN = { ...COMMENT, nodeType: 'info', name: 'A plain node', asComment: null, embeddingPendingAt: null, embeddingFailedAt: null, embeddingError: null };
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'A comment', nodeType: 'comment', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

let served: Record<string, unknown> = COMMENT;
beforeEach(() => {
  served = COMMENT;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: served };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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

async function mountPage(node: Record<string, unknown>, enabled = true) {
  served = node;
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue({ ...PARENT, graph: { ...PARENT.graph, vectorIndexEnabled: enabled } }),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded, graph: { ...PARENT.graph, vectorIndexEnabled: enabled }, canWriteMemory: true }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m;
}


describe('#257 node detail embedding state', () => {
  it('shows pending without failure on a queued node', async () => {
    const { target } = await mountPage({ ...PLAIN, embeddingPendingAt: '2026-10-24T00:00:00Z' });
    expect(target.querySelector('[data-testid="embedding-pending"]')?.textContent).toContain('Embedding pending');
    expect(target.querySelector('[data-testid="embedding-failed"]')).toBeNull();
  });
  it('shows failure with error text escaped, including encrypted-no-plaintext', async () => {
    const error = 'encrypted-no-plaintext (#206) <img src=x onerror="alert(1)">';
    const { target } = await mountPage({ ...PLAIN, embeddingFailedAt: '2026-10-24T00:00:00Z', embeddingError: error });
    const badge = target.querySelector('[data-testid="embedding-failed"]');
    expect(badge?.textContent).toContain(error);
    expect(badge?.querySelector('img')).toBeNull();
    expect(target.querySelector('[data-testid="embedding-pending"]')).toBeNull();
  });
  it('shows the failure label even when the error reason is null', async () => {
    const { target } = await mountPage({ ...PLAIN, embeddingFailedAt: '2026-10-24T00:00:00Z' });
    expect(target.querySelector('[data-testid="embedding-failed"]')?.textContent?.trim()).toBe('Embedding failed');
  });
  it('leaves no empty status container when all stamps are null', async () => {
    const { target } = await mountPage(PLAIN);
    expect(target.querySelector('[data-testid="node-embedding-state"]')).toBeNull();
  });
  it('hides stale stamps when vector indexing is disabled', async () => {
    const { target } = await mountPage({ ...PLAIN, embeddingPendingAt: '2026-10-24T00:00:00Z', embeddingFailedAt: '2026-10-23T00:00:00Z', embeddingError: 'old' }, false);
    expect(target.querySelector('[data-testid="node-embedding-state"]')).toBeNull();
  });
  it('shows both reported states during retry backoff, without claiming terminal failure', async () => {
    const { target } = await mountPage({ ...PLAIN, embeddingPendingAt: '2099-01-01T00:00:00Z', embeddingFailedAt: '2026-10-24T00:00:00Z', embeddingError: 'endpoint unavailable' });
    expect(target.querySelector('[data-testid="embedding-pending"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="embedding-failed"]')?.textContent).toContain('endpoint unavailable');
  });
});
