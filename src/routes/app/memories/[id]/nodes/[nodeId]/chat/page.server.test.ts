import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION, CREATE_TEAM_CHAT_MESSAGE_MUTATION, NODE_BY_ID_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEvent(fields: Record<string, string>, user: Record<string, unknown> | null = { handle: 'holger' }) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: 'mem-1', nodeId: 'chat-1' },
    locals: { token: 'tok', user },
    request: { formData: async () => fd },
  } as any;
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function send(fields: Record<string, string>, user?: Record<string, unknown> | null) {
  const actions = await importActions();
  return actions.sendMessage(actionEvent(fields, user));
}

/** A legacy portal-written chat: `team-chat`-tagged, no App behind it. */
function legacyChat(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-1', memoryId: 'mem-1', loc: 'team:chat', nodeType: 'info',
    tags: ['team-chat'], memory: { id: 'mem-1', appId: null }, ...over,
  };
}

/** The App's one well-known team chat (server #939). */
function teamChat(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-1', memoryId: 'mem-1', loc: 'chats:team', nodeType: 'chat',
    tags: [], memory: { id: 'mem-1', appId: 'app-1' }, ...over,
  };
}

describe('chat sendMessage action', () => {
  it('creates a message node from validated trimmed content (legacy, no App)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: legacyChat(),
    });
    mockRequest.mockResolvedValueOnce({
      createNode: { id: 'message-1', loc: 'team:chat:messages:20260720T120000Z-holger' },
    });

    const result = await send({
      _kind: 'sendChatMessage',
      content: '  hello team  ',
    });

    expect(result).toMatchObject({ sent: true, messageNode: { nodeId: 'message-1' } });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Message sent.' });
    expect(mockRequest).toHaveBeenNthCalledWith(1, NODE_BY_ID_QUERY, { ref: 'chat-1' });
    expect(mockRequest).toHaveBeenNthCalledWith(2, CREATE_NODE_MUTATION, {
      input: expect.objectContaining({
        memoryId: 'mem-1',
        loc: expect.stringMatching(/^team:chat:messages:/),
        name: 'holger',
        nodeType: 'message',
        data: { body: 'hello team', author: 'holger' },
      }),
    });
  });

  it('posts a platform chat through createTeamChatMessage, using the memory appId', async () => {
    mockRequest.mockResolvedValueOnce({
      node: teamChat(),
    });
    mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'message-1' } });

    const result = await send({ _kind: 'sendChatMessage', content: 'hello team' });

    expect(result).toMatchObject({ sent: true, messageNode: { nodeId: 'message-1' } });
    expect(mockRequest).toHaveBeenNthCalledWith(2, CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
      appRef: 'app-1', body: 'hello team',
    });
  });

  it('refuses a direct POST aimed at a node that is not a chat', async () => {
    // Form actions run before `load`, so the load's redirect is not the gate:
    // without this check the body would post into the App's real team chat.
    mockRequest.mockResolvedValueOnce({
      node: { id: 'chat-1', memoryId: 'mem-1', loc: 'notes:x', nodeType: 'info', tags: [], memory: { id: 'mem-1', appId: 'app-1' } },
    });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'This node is not a chat.' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses a chat node the platform operation would post elsewhere', async () => {
    mockRequest.mockResolvedValueOnce({ node: teamChat({ loc: 'chats:design-review' }) });

    const result = (await send({ _kind: 'sendChatMessage', content: 'hello' })) as { status: number };

    expect(result.status).toBe(400);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects empty content before calling GraphQL', async () => {
    const result = (await send({ _kind: 'sendChatMessage', content: '   ' })) as {
      status: number;
    };

    expect(result.status).toBe(400);
    expect(fieldError(result, 'content')).toBe('Message cannot be empty');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = (await send({
      _kind: 'createFlowEdge',
      content: 'hello',
    })) as { status: number };

    expect(result.status).toBe(400);
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed auth error when no user is available', async () => {
    mockRequest.mockResolvedValueOnce({
      node: legacyChat(),
    });

    const result = (await send(
      { _kind: 'sendChatMessage', content: 'hello' },
      null,
    )) as { status: number };

    expect(result.status).toBe(401);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Not authenticated' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('extracts GraphQL failure messages into the Superforms message', async () => {
    mockRequest.mockResolvedValueOnce({
      node: legacyChat(),
    });
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Cannot create message' }] },
    });

    const result = (await send({
      _kind: 'sendChatMessage',
      content: 'hello',
    })) as { status: number };

    expect(result.status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Cannot create message',
    });
  });
});
