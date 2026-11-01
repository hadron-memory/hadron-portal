/**
 * portal#1525 — the node page's full-screen entry, branched on whether the
 * chat is the App's team CHANNEL.
 *
 * The real page over the real loader (#995 harness pattern): a team channel
 * gets an icon-only entry with an accessible name (the label IS the
 * aria-label — there is no visible text to read), while any other chat keeps
 * today's "Full-screen chat" text button verbatim. The classification is the
 * loader's (`chatPostTarget` platform kind), never a name heuristic — Xylon's
 * binding scope on #1525.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODES_BY_LOC_PREFIX_QUERY } from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';
// Static imports: the page is large (see form-ids.client.test.ts).
import Page from './+page.svelte';
import { load } from './+page.server';

const MEM = 'mem-1';
const reads = serveMemoryReads([], { id: MEM, urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const PARENT = {
  graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'Acme Notes', class: 'knowledge', appId: 'app-1' },
  graphNodes: [],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

function chatNode(loc: string) {
  return {
    id: 'chat-pk', memoryId: MEM, loc, name: 'chat', nodeType: 'chat',
    alias: null, description: null, content: null, abstract: null,
    data: null, properties: null, tags: [], seq: null, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    memory: {
      id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'Acme Notes', appId: 'app-1',
      app: { id: 'app-1', name: 'Atlas', urn: 'hrn:app:acme.com:atlas' },
    },
  };
}

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage(`http://localhost/app/memories/${MEM}/nodes/chat-pk`, { id: MEM, nodeId: 'chat-pk' });
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

async function mountChatNodePage(loc: string) {
  const node = chatNode(loc);
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    { const served = reads(doc, vars); if (served !== undefined) return served; }
    if (doc === NODE_BY_ID_QUERY) return { node };
    if (doc === NODES_BY_LOC_PREFIX_QUERY) return { findNodes: { hits: [] } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const loaded = (await load({
    params: { id: MEM, nodeId: 'chat-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m.target;
}

describe('node page full-screen entry (portal#1525)', () => {
  it('a team channel offers the icon-only entry with an accessible name, not the text button', async () => {
    const target = await mountChatNodePage('chats:team');

    const entry = target.querySelector<HTMLAnchorElement>('a[aria-label="Open full-screen channel"]');
    expect(entry).not.toBeNull();
    expect(entry!.getAttribute('href')).toBe(`/app/memories/${MEM}/nodes/chat-pk/chat`);
    // Icon-only: the visible label is the old text button's, and it is gone.
    expect(entry!.textContent?.trim()).toBe('');
    expect(target.textContent).not.toContain('Full-screen chat');
  });

  it('a chat that is not the App team chat keeps the text entry verbatim', async () => {
    const target = await mountChatNodePage('chats:design-review');

    expect(target.textContent).toContain('Full-screen chat');
    expect(target.querySelector('a[aria-label="Open full-screen channel"]')).toBeNull();
  });
});
