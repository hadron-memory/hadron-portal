import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION, NODES_BY_LOC_PREFIX_QUERY, NODE_BY_ID_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';

beforeEach(() => {
  mockRequest.mockReset();
});

function nodeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-pk', memoryId: MEM, loc: 'chats:team', name: 'team',
    nodeType: 'info', alias: null, description: null, content: null, abstract: null,
    data: null, properties: null, tags: ['team-chat'], seq: null, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

// Route the mocked GraphQL client by document so the load's fetch order (which
// includes streamed, best-effort calls) doesn't make these tests brittle.
function routeRequests(over: { messages?: unknown; node?: Record<string, unknown> } = {}) {
  const node = over.node ?? nodeRow();
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
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
      graphNodes: [], graph: { id: MEM, urn: 'hrn:mem:acme.com:notes' },
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];
  return (await load(event)) as unknown as {
    isChat: boolean;
    chatMessages: Array<{ id: string; content: string }> | null;
    initialTab: string | null;
  };
}

describe('node-detail load — Chat tab', () => {
  it('loads the thread for a `team-chat` node', async () => {
    routeRequests({
      messages: {
        findNodes: {
          hits: [{ node: { id: 'm-1', loc: 'chats:team:messages:a', name: 'holger', content: 'hi', data: null, createdAt: '2026-08-14T09:00:00Z' } }],
        },
      },
    });

    const data = await runLoad();

    expect(data.isChat).toBe(true);
    expect(data.chatMessages).toMatchObject([{ id: 'm-1', content: 'hi', author: 'holger' }]);
    expect(mockRequest).toHaveBeenCalledWith(NODES_BY_LOC_PREFIX_QUERY, expect.objectContaining({
      memoryId: MEM, locPrefix: 'chats:team:messages:',
    }));
  });

  it('does not query messages for an ordinary node', async () => {
    routeRequests({ node: nodeRow({ tags: [] }) });

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

  it('posts to the memory the node actually lives in, not the URL id (#237)', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow() });
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'm-1' } });

    const result = await send({ _kind: 'sendChatMessage', content: '  hello team  ' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Message sent.' });
    expect(mockRequest).toHaveBeenNthCalledWith(1, NODE_BY_ID_QUERY, { ref: 'chat-pk' });
    expect(mockRequest).toHaveBeenNthCalledWith(2, CREATE_NODE_MUTATION, {
      input: expect.objectContaining({
        memoryId: MEM,
        loc: expect.stringMatching(/^chats:team:messages:/),
        name: 'holger',
        nodeType: 'message',
        data: { body: 'hello team', author: 'holger' },
      }),
    });
  });

  it('refuses to post to a node that is not a chat', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow({ tags: [] }) });

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
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Cannot create message' });
  });
});
