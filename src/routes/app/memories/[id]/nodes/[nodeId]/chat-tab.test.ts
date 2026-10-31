import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_NODE_MUTATION,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  LEGACY_THREAD_PROBE_QUERY,
  NODES_BY_LOC_PREFIX_QUERY,
  NODE_BY_ID_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';

beforeEach(() => {
  mockRequest.mockReset();
});

function nodeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-pk', memoryId: MEM, memory: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'notes', appId: 'app-1' },
    loc: 'chats:team', name: 'team',
    nodeType: 'chat', alias: null, description: null, content: null, abstract: null,
    data: null, properties: null, tags: [], seq: null, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

/** The #926 probe's answer: one direct legacy message under `loc`. */
function legacyThreadOf(loc: string) {
  return { findNodes: { total: 1, hits: [{ node: { loc: `${loc}:messages:001-ada`, nodeType: 'message' } }] } };
}

// Route the mocked GraphQL client by document so the load's fetch order (which
// includes streamed, best-effort calls) doesn't make these tests brittle.
function routeRequests(over: { messages?: unknown; node?: Record<string, unknown> } = {}) {
  const node = over.node ?? nodeRow();
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
    // #926: a tag-only root is a chat only with a legacy message under it.
    if (doc === LEGACY_THREAD_PROBE_QUERY) return legacyThreadOf(node.loc as string);
    if (doc === NODES_BY_LOC_PREFIX_QUERY) {
      if (over.messages instanceof Error) throw over.messages;
      return over.messages ?? { findNodes: { hits: [] } };
    }
    return { memories: { items: [], total: 0 } };
  });
  return node;
}

async function runLoad(tab?: string) {
  const { load } = await import('./+page.server');
  const url = new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk${tab ? `?tab=${tab}` : ''}`);
  const event = {
    params: { id: MEM, nodeId: 'chat-pk' },
    locals: { token: 'tok' },
    url,
    parent: vi.fn().mockResolvedValue({
      graphNodes: [], graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', appId: 'app-1' },
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];
  return (await load(event)) as unknown as {
    isChat: boolean;
    canPostChat: boolean;
    chatMessages: Array<{ id: string; content: string }> | null;
    initialTab: string | null;
  };
}

describe('node-detail load — Chat tab', () => {
  it('loads the thread for a platform `chat` node', async () => {
    routeRequests({
      messages: {
        findNodes: {
          hits: [{ node: { id: 'm-1', loc: 'chats:team:messages:001-x-h', name: '001-holger', nodeType: 'chat-message', seq: 1, content: 'hi', data: { authorName: 'holger' }, createdAt: '2026-08-14T09:00:00Z' } }],
        },
      },
    });

    const data = await runLoad();

    expect(data.isChat).toBe(true);
    expect(data.canPostChat).toBe(true);
    expect(data.chatMessages).toMatchObject([{ id: 'm-1', content: 'hi', author: 'holger', seq: 1 }]);
    expect(mockRequest).toHaveBeenCalledWith(NODES_BY_LOC_PREFIX_QUERY, expect.objectContaining({
      memoryId: MEM, locPrefix: 'chats:team:messages:',
    }));
  });

  it('still loads the thread for a legacy `team-chat`-tagged node', async () => {
    routeRequests({ node: nodeRow({ nodeType: 'info', loc: 'chats:standup', tags: ['team-chat'] }) });

    const data = await runLoad();
    expect(data.isChat).toBe(true);
    expect(data.canPostChat).toBe(true);
  });

  it('reads a chat that is not the App team chat, but offers no composer', async () => {
    // createTeamChatMessage would post to `chats:team`, not to this thread.
    routeRequests({ node: nodeRow({ loc: 'chats:design-review' }) });

    const data = await runLoad();
    expect(data.isChat).toBe(true);
    expect(data.canPostChat).toBe(false);
  });

  it('does not query messages for an ordinary node', async () => {
    routeRequests({ node: nodeRow({ nodeType: 'info', tags: [] }) });

    const data = await runLoad();

    expect(data.isChat).toBe(false);
    expect(data.chatMessages).toBeNull();
    expect(mockRequest).not.toHaveBeenCalledWith(NODES_BY_LOC_PREFIX_QUERY, expect.anything());
  });

  it('degrades to an empty thread when the message query fails (page still loads)', async () => {
    routeRequests({ messages: new Error('boom') });

    const data = await runLoad();

    expect(data.isChat).toBe(true);
    expect(data.chatMessages).toEqual([]);
  });

  it('passes `?tab=` through for the deep link', async () => {
    routeRequests();
    expect((await runLoad('content')).initialTab).toBe('content');
    expect((await runLoad()).initialTab).toBeNull();
  });
});

describe('node-detail sendChatMessage action', () => {
  function actionEvent(fields: Record<string, string>, user: Record<string, unknown> | null = { handle: 'holger' }) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return {
      params: { id: 'stale-mem', nodeId: 'chat-pk' },
      locals: { token: 'tok', user },
      request: { formData: async () => fd },
    } as never;
  }

  async function send(fields: Record<string, string>, user?: Record<string, unknown> | null) {
    const { actions } = await import('./+page.server');
    return actions.sendChatMessage(actionEvent(fields, user));
  }

  function superFormFrom(result: unknown) {
    const r = result as { data?: { form?: unknown }; form?: unknown } | undefined;
    return (r?.data?.form ?? r?.form) as { message?: unknown; errors?: Record<string, string[]> } | undefined;
  }

  it('posts through the platform operation, with the appRef off the node (#237)', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow() });
    mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'm-1' } });

    const result = await send({ _kind: 'sendChatMessage', content: '  hello team  ' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Message sent.' });
    expect(mockRequest).toHaveBeenNthCalledWith(1, NODE_BY_ID_QUERY, { ref: 'chat-pk' });
    // The URL says `stale-mem`; the appRef and memory come from the node.
    expect(mockRequest).toHaveBeenNthCalledWith(2, CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
      appRef: 'app-1', body: 'hello team',
    });
  });

  it('keeps a legacy tagged thread on the node path even inside an App memory', async () => {
    // The memory's appId must NOT reroute this into the App's team chat — the
    // message would land in a different thread than the one on screen.
    mockRequest.mockResolvedValueOnce({
      node: nodeRow({ nodeType: 'info', loc: 'chats:standup', tags: ['team-chat'] }),
    });
    mockRequest.mockResolvedValueOnce(legacyThreadOf('chats:standup'));
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'm-1' } });

    await send({ _kind: 'sendChatMessage', content: 'hello team' });

    expect(mockRequest).toHaveBeenNthCalledWith(2, LEGACY_THREAD_PROBE_QUERY, expect.objectContaining({ locPrefix: 'chats:standup:messages:' }));
    expect(mockRequest).toHaveBeenNthCalledWith(3, CREATE_NODE_MUTATION, {
      input: expect.objectContaining({
        memoryId: MEM,
        loc: expect.stringMatching(/^chats:standup:messages:/),
        nodeType: 'message',
      }),
    });
  });

  it('refuses to post to a chat node that has no post target', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow({ loc: 'chats:design-review' }) });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses to post to a node that is not a chat', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow({ nodeType: 'info', tags: [] }) });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'This node is not a chat.' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects empty content before calling GraphQL', async () => {
    const result = (await send({ _kind: 'sendChatMessage', content: '   ' })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.content?.[0]).toBe('Message cannot be empty');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = (await send({ _kind: 'updateContent', content: 'hello' })) as { status: number };

    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed auth error when no user is available', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow() });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' }, null)) as { status: number };

    expect(result.status).toBe(401);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Not authenticated' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('extracts GraphQL failures into the Superforms message', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow() });
    mockRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'Cannot create message' }] } });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' })) as { status: number };

    expect(result.status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
  });
});
