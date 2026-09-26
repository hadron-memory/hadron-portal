/**
 * #926 (part 1) — a MESSAGE is never a chat root, whatever its tags.
 *
 * Legacy messages carry the `team-chat` tag, and so do the platform
 * `chat-message` nodes cloned from them — e.g.
 * hrn:node:micromentor.org:mm-eng-team-shared:chats:team:messages:001-academy-iris,
 * one of 142. The tag alone made each a "chat": a Chat tab on the message page,
 * and a post target that would have written legacy messages UNDER a message.
 *
 * Every consumer of the predicate is exercised with the real shapes, including
 * the direct action submissions (actions run before `load`, so the page never
 * offering a composer is not the gate). Each case is paired with the genuine
 * root it must still accept, so a predicate that refuses everything fails too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { chatPostTarget, isChatMessageNode, isChatNode } from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';
beforeEach(() => {
  mockRequest.mockReset();
});

function row(over: Record<string, unknown>) {
  return {
    id: 'pk', memoryId: MEM,
    memory: { id: MEM, urn: 'hrn:mem:micromentor.org:mm-eng-team-shared', name: 'shared', appId: 'app-1' },
    name: 'x', alias: null, description: null, content: 'hello', abstract: null,
    data: null, properties: null, seq: 1, isRunnable: null, role: null, revision: 1,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

/** The cloned platform message, as stored. */
const clonedMessage = row({
  loc: 'chats:team:messages:001-academy-iris', nodeType: 'chat-message', tags: ['team-chat', 'iris', 'check-in'],
});
/** A legacy portal message, as stored in hrn:mem:hadronmemory.com:experiments. */
const legacyMessage = row({
  loc: 'team-chat:academy:chat:messages:2026-06-21T175936Z-iris', nodeType: 'message',
  tags: ['team-chat', 'iris', 'check-in'], memory: { id: MEM, urn: 'hrn:mem:hadronmemory.com:experiments', name: 'x', appId: null },
});
/** Its legacy root — still a chat. */
const legacyRoot = row({
  loc: 'team-chat:academy:chat', nodeType: 'info', tags: ['team-chat'],
  memory: { id: MEM, urn: 'hrn:mem:hadronmemory.com:experiments', name: 'x', appId: null },
});
/** The App's platform root — still a chat. */
const platformRoot = row({ loc: 'chats:team', nodeType: 'chat', tags: [] });

const MESSAGES = [['a cloned chat-message', clonedMessage], ['a legacy message', legacyMessage]] as const;
const ROOTS = [['the legacy root', legacyRoot, 'legacy'], ['the platform root', platformRoot, 'platform']] as const;

describe('the predicate and the post target', () => {
  it.each(MESSAGES)('%s tagged team-chat is a message, not a root, and has nowhere to post', (_n, node) => {
    expect(isChatMessageNode(node as unknown as MemoryNode)).toBe(true);
    expect(isChatNode(node as unknown as MemoryNode)).toBe(false);
    expect(chatPostTarget(node as unknown as MemoryNode)).toEqual({ kind: 'none' });
  });

  it.each(ROOTS)('%s is still a chat with its own post target', (_n, node, kind) => {
    expect(isChatNode(node as unknown as MemoryNode)).toBe(true);
    expect(chatPostTarget(node as unknown as MemoryNode).kind).toBe(kind);
  });
});

function answerNode(node: unknown) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
    if (/findNodes/.test(doc)) return { findNodes: { total: 0, hits: [] } };
    return { memories: { items: [], total: 0 } };
  });
}

/** Every write the handler attempted — anything that was not a read. */
const writes = () => mockRequest.mock.calls.map(([d]) => d as string).filter((d) => /^\s*mutation|\bmutation\b/.test(d));

describe('node detail load', () => {
  async function load(node: Record<string, unknown>, graphNodes: unknown[] = []) {
    answerNode(node);
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: MEM, nodeId: 'pk' },
      locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/pk`),
      parent: vi.fn().mockResolvedValue({
        graphNodes, graph: { id: MEM, urn: 'hrn:mem:acme.com:m', appId: 'app-1' },
        isConsumerMode: false, activeOrgId: 'org-1',
      }),
    } as never)) as unknown as { isChat: boolean; isChatMessage: boolean; canPostChat: boolean; openChat: unknown };
  }

  it.each(MESSAGES)('%s gets no Chat tab and no composer, and is still marked a message', async (_n, node) => {
    const data = await load(node);
    expect(data.isChat).toBe(false);
    expect(data.canPostChat).toBe(false);
    expect(data.isChatMessage).toBe(true);
  });

  it('a tagged message still links to its root via Open chat', async () => {
    const data = await load(clonedMessage, [
      { id: 'root-pk', memoryId: MEM, loc: 'chats:team', name: 'team', nodeType: 'chat', tags: [] },
    ]);
    expect(data.openChat).toEqual({ nodeId: 'root-pk', loc: 'chats:team', name: 'team' });
  });

  it.each(ROOTS)('%s keeps its Chat tab and composer', async (_n, node) => {
    const data = await load(node);
    expect(data.isChat).toBe(true);
    expect(data.canPostChat).toBe(true);
  });
});

describe('direct POSTs — the action is the gate, not the page', () => {
  function form(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it.each(MESSAGES)('the node page action refuses to post under %s', async (_n, node) => {
    answerNode(node);
    const { actions } = await import('./+page.server');
    const result = (await (actions as Record<string, (e: never) => Promise<unknown>>).sendChatMessage({
      request: { formData: async () => form({ _kind: 'sendChatMessage', content: 'hello' }) },
      params: { id: MEM, nodeId: 'pk' },
      locals: { token: 'tok', user: { handle: 'holger' } },
    } as never)) as { status: number };
    expect(result.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it.each(MESSAGES)('the /chat view action refuses to post under %s', async (_n, node) => {
    answerNode(node);
    const { actions } = await import('./chat/+page.server');
    const result = (await (actions as Record<string, (e: never) => Promise<unknown>>).sendMessage({
      request: { formData: async () => form({ _kind: 'sendChatMessage', content: 'hello' }) },
      params: { id: MEM, nodeId: 'pk' },
      locals: { token: 'tok', user: { handle: 'holger' } },
    } as never)) as { status: number };
    expect(result.status).toBe(400);
    expect(writes()).toEqual([]);
  });
});

describe('/chat view load and chat-older', () => {
  it.each(MESSAGES)('the /chat view redirects %s back to its node page', async (_n, node) => {
    answerNode(node);
    const { load } = await import('./chat/+page.server');
    let thrown: unknown;
    try {
      await load({
        params: { id: MEM, nodeId: 'pk' },
        locals: { token: 'tok' },
        url: new URL(`http://localhost/app/memories/${MEM}/nodes/pk/chat`),
        parent: vi.fn().mockResolvedValue({ graph: { id: MEM, urn: 'hrn:mem:acme.com:m' }, graphNodes: [] }),
      } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ status: 303, location: `/app/memories/${MEM}/nodes/pk` });
  });

  it.each(MESSAGES)('chat-older answers 404 not-a-chat for %s', async (_n, node) => {
    answerNode(node);
    const { GET } = await import('./chat-older/+server');
    const res = await GET({
      params: { id: MEM, nodeId: 'pk' },
      url: new URL(`http://localhost/x?before=50`),
      locals: { token: 'tok' },
    } as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: 'not-a-chat' });
  });

  it('chat-older still serves a genuine root', async () => {
    answerNode(platformRoot);
    const { GET } = await import('./chat-older/+server');
    const res = await GET({
      params: { id: MEM, nodeId: 'pk' },
      url: new URL(`http://localhost/x?before=50`),
      locals: { token: 'tok' },
    } as never);
    expect(res.status).toBe(200);
  });
});
