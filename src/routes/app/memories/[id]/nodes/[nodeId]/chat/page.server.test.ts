import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION, CREATE_TEAM_CHAT_MESSAGE_MUTATION, LEGACY_THREAD_PROBE_QUERY, NODE_BY_ID_QUERY } from '$lib/server/queries';

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

/** #926: the probe's answer for `legacyChat()`, a direct legacy message under it. */
const LEGACY_THREAD = { findNodes: { total: 1, hits: [{ node: { loc: 'team:chat:messages:001-ada', nodeType: 'message' } }] } };

/** The App's one well-known team chat (server #939). */
function teamChat(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-1', memoryId: 'mem-1', loc: 'chats:team', nodeType: 'chat',
    tags: [], memory: { id: 'mem-1', appId: 'app-1' }, ...over,
  };
}

describe('chat page load — fullUrn', () => {
  async function loadWith(memoryUrn: string | null, node: Record<string, unknown>) {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === LEGACY_THREAD_PROBE_QUERY) return LEGACY_THREAD;
      // loadChatMessages' NODES_BY_LOC_PREFIX_QUERY — an empty thread is fine,
      // the URN is what's under test.
      return { findNodes: { hits: [] } };
    });
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'mem-1', nodeId: 'chat-1' },
      locals: { token: 'tok', user: { handle: 'holger' } },
      parent: async () => ({ graph: memoryUrn ? { id: 'mem-1', urn: memoryUrn } : null }),
    } as any)) as any;
  }

  // The team chat's badge read `hrn:mem:…:chats:team` — a NODE URN wearing the
  // MEMORY type word, because the old code concatenated `graph.urn` with the
  // loc. hrn:node:hadronmemory.com:specs:cor:urn:010:01 makes `mem` vs `node` unrecoverable from the string, so
  // that badge addressed a different entity class than the page showing it.
  it('emits an hrn:node: URN, not the memory URN with the loc appended', async () => {
    const data = await loadWith('hrn:mem:hadronmemory.com:hadron-dev-team-shared', teamChat());
    expect(data.fullUrn).toBe('hrn:node:hadronmemory.com:hadron-dev-team-shared:chats:team');
    expect(data.fullUrn.startsWith('hrn:mem:')).toBe(false);
  });

  // #728: v2 is flat, single-colon throughout. The old code joined with `::`,
  // which `parseUrnV2` rejects outright.
  it('emits grammar v2 (no `::` separator)', async () => {
    const data = await loadWith('hrn:mem:hadronmemory.com:hadron-dev-team-shared', teamChat());
    expect(data.fullUrn).not.toContain('::');
  });

  // An ownership chain (>2 atoms) has no string-derivable v2 form and must be
  // emitted unchanged — `composeNodeUrn` owns that carve-out, so this pins that
  // the loader routes through it rather than re-deriving the easy case itself.
  it('leaves a v1 ownership chain in v1 form', async () => {
    const data = await loadWith('hrn:memory:micromentor.org::coding-app::coding-agent::system', teamChat());
    expect(data.fullUrn).toBe(
      'hrn:node:micromentor.org::coding-app::coding-agent::system::chats:team',
    );
  });

  // composeNodeUrn is strict at input and throws; the transcript must still
  // render. Falls back to the bare loc rather than 500-ing the page.
  it('falls back to the bare loc when the memory URN has a wrong-type prefix', async () => {
    const data = await loadWith('hrn:app:hadronmemory.com:hadron-dev-team', teamChat());
    expect(data.fullUrn).toBe('chats:team');
    expect(data.messages).toEqual([]);
  });

  // #489 part 4 (@codex on PR #791). The node page grew an App reference; this
  // is the surface a reader STAYS on and it is one click away, so the reference
  // has to survive the hop. Rendering it on one and not the other would make
  // the affordance vanish exactly when the reader settles in — reintroducing
  // the navigation gap the reference exists to close.
  const APP = { id: 'app-1', urn: 'hrn:app:acme.com:workstation', name: 'Workstation' };

  it('exposes the App for a team chat, so the reference survives the hop', async () => {
    const data = await loadWith(
      'hrn:mem:acme.com:notes',
      teamChat({ memory: { id: 'mem-1', appId: APP.id, app: APP } }),
    );
    expect(data.chatApp).toEqual(APP);
  });

  it('is null for a chat with no App — absent, never an empty chip', async () => {
    // A legacy portal-written chat has no App and is still readable. The header
    // must render nothing rather than a chip with no name behind it.
    const data = await loadWith('hrn:mem:acme.com:notes', legacyChat());
    expect(data.chatApp).toBeNull();
  });

  it('normalises an UNSELECTED app to null, not undefined', async () => {
    // `app` is detail-only on NODE_BY_ID_QUERY. A row without the key is a
    // different fact from `app: null`, and `undefined` would serialise away
    // rather than travel as an explicit "none". Pins the `?? null`, which a
    // mutation survived on the node-page side until a case reached it.
    const data = await loadWith('hrn:mem:acme.com:notes', teamChat());
    expect(data.chatApp).toBeNull();
    expect(data.chatApp).not.toBeUndefined();
  });
});

describe('chat sendMessage action', () => {
  it('creates a message node from validated trimmed content (legacy, no App)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: legacyChat(),
    });
    mockRequest.mockResolvedValueOnce(LEGACY_THREAD);
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
    expect(mockRequest).toHaveBeenNthCalledWith(2, LEGACY_THREAD_PROBE_QUERY, expect.objectContaining({ locPrefix: 'team:chat:messages:' }));
    expect(mockRequest).toHaveBeenNthCalledWith(3, CREATE_NODE_MUTATION, {
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
    mockRequest.mockResolvedValueOnce(LEGACY_THREAD);

    const result = (await send(
      { _kind: 'sendChatMessage', content: 'hello' },
      null,
    )) as { status: number };

    expect(result.status).toBe(401);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Not authenticated' });
    // The node read and the #926 thread probe; nothing written.
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('extracts GraphQL failure messages into the Superforms message', async () => {
    mockRequest.mockResolvedValueOnce({
      node: legacyChat(),
    });
    mockRequest.mockResolvedValueOnce(LEGACY_THREAD);
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
