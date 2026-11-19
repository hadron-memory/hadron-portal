/**
 * portal#1828 — the PAGE wiring of a failed chat load, on both surfaces, over the REAL loaders.
 *
 * Component tests alone cannot see this: replacing `loadFailed={data.chatLoadFailed ?? false}` with
 * `false`, or the Retry handler with a no-op, leaves them green (Gaia, local review on #2281).
 * The chat read rejects here, so the flag travels loader -> page -> ChatThread exactly as shipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { NODE_BY_ID_QUERY, NODES_BY_LOC_PREFIX_QUERY } from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';
// Static imports: the node page is large (see form-ids.client.test.ts).
import NodePage from './+page.svelte';
import { load as loadNode } from './+page.server';
import FullScreenPage from './chat/+page.svelte';
import { load as loadFullScreen } from './chat/+page.server';

const MEM = 'mem-1';
const reads = serveMemoryReads([], { id: MEM, urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
const mockLoadChatMessages = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/server/team-chat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadChatMessages: (...a: unknown[]) => mockLoadChatMessages(...a),
}));

const PARENT = {
  graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'Acme Notes', class: 'knowledge', appId: 'app-1' },
  graphNodes: [],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const NODE = {
  id: 'chat-pk', memoryId: MEM, loc: 'chats:team', name: 'chat', nodeType: 'chat',
  alias: null, description: null, content: null, abstract: null,
  data: null, properties: null, tags: [], seq: null, isRunnable: null,
  createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
  memory: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'Acme Notes', appId: 'app-1', app: { id: 'app-1', name: 'Atlas', urn: 'hrn:app:acme.com:atlas' } },
};
const EMPTY = { messages: [], total: 0, hasOlder: false, offset: 0 };

beforeEach(() => {
  mockRequest.mockReset();
  mockLoadChatMessages.mockReset();
  resetNavigationCalls();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setStubPage(`http://localhost/app/memories/${MEM}/nodes/chat-pk`, { id: MEM, nodeId: 'chat-pk' });
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    const served = reads(doc, vars);
    if (served !== undefined) return served;
    if (doc === NODE_BY_ID_QUERY) return { node: NODE };
    if (doc === NODES_BY_LOC_PREFIX_QUERY) return { findNodes: { hits: [] } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

const SURFACES = [
  ['node-detail inline chat', NodePage, loadNode, `/app/memories/${MEM}/nodes/chat-pk?tab=chat`],
  ['full-screen chat route', FullScreenPage, loadFullScreen, `/app/memories/${MEM}/nodes/chat-pk/chat`],
] as const;

describe.each(SURFACES)('portal#1828 page wiring: %s', (_name, Page, load, path) => {
  async function mountSurface() {
    const loaded = (await load({
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
      url: new URL(`http://localhost${path}`),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as Record<string, unknown>;
    const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await settle();
    return m.target;
  }
  const retryButton = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry');

  it('a rejected chat read renders the failed state, not the empty-thread wording', async () => {
    mockLoadChatMessages.mockRejectedValue(new Error('boom'));
    const target = await mountSurface();
    expect(target.querySelector('[data-testid="chat-load-failed"]')).not.toBeNull();
    expect(target.textContent).not.toContain('No messages yet');
  });

  it('control: a genuinely empty thread keeps the empty wording and no failed state', async () => {
    mockLoadChatMessages.mockResolvedValue(EMPTY);
    const target = await mountSurface();
    expect(target.querySelector('[data-testid="chat-load-failed"]')).toBeNull();
    expect(target.textContent).toContain('No messages yet');
  });

  it('Retry reaches invalidateAll, once per activation', async () => {
    mockLoadChatMessages.mockRejectedValue(new Error('boom'));
    const target = await mountSurface();
    const before = navigationCalls.filter((c) => c.fn === 'invalidateAll').length;
    retryButton(target)!.click();
    await settle();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll').length).toBe(before + 1);
  });
});
