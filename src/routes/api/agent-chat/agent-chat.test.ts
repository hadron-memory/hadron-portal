/**
 * Integration-ish tests for the /api/agent-chat/* SvelteKit endpoints.
 *
 * Strategy: mock `$lib/server/api` (GraphQL client), `$lib/server/llm/agentChatTurn`
 * (runChatTurn), and `$lib/server/llm/agentChatLlm` (callAgentChatLlm). Import
 * each `+server.ts` module and invoke its POST/GET handler directly with a
 * hand-rolled `RequestEvent`-shaped object. We don't spin up SvelteKit.
 *
 * These tests verify the thin-wrapper behavior of each endpoint:
 *   - auth gating (401 without locals.token)
 *   - body validation
 *   - correct GraphQL op + variables passed through
 *   - correct shape returned on success
 *   - error responses on failure
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_CHAT_PAGE_SIZE } from '$lib/agent-chat-window';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

const mockRunChatTurn = vi.fn();
vi.mock('$lib/server/llm/agentChatTurn', () => ({
  runChatTurn: mockRunChatTurn,
}));
vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  runChatTurn: mockRunChatTurn,
}));

const mockCallAgentChatLlm = vi.fn();
vi.mock('$lib/server/llm/agentChatLlm', () => ({
  callAgentChatLlm: mockCallAgentChatLlm,
}));
vi.mock('$lib/server/llm/agentChatLlm.js', () => ({
  callAgentChatLlm: mockCallAgentChatLlm,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal RequestEvent-shaped object. */
function ev(opts: {
  token?: string | null;
  body?: unknown;
  searchParams?: Record<string, string>;
}) {
  const token = opts.token === undefined ? 'test-token' : opts.token;
  const request = {
    json: async () => {
      if (opts.body === '__invalid__') throw new Error('bad json');
      return opts.body;
    },
  };
  const url = new URL('http://localhost/test');
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) url.searchParams.set(k, v);
  return {
    request,
    locals: { token },
    url,
  } as any;
}

/** `n` consecutive messages starting at seq `from`, oldest-first — the shape
 *  `chatHistory` returns. */
function page(n: number, from: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message-${from + i}`,
    seq: from + i,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, from + i)).toISOString(),
  }));
}

async function jsonOf(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

beforeEach(() => {
  mockRequest.mockReset();
  mockRunChatTurn.mockReset();
  mockCallAgentChatLlm.mockReset();
});

// ── /api/agent-chat/start ──────────────────────────────────────────────────

describe('POST /api/agent-chat/start', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ token: null, body: { agentId: 'a1' } }));
    expect(res.status).toBe(401);
  });

  it('requires agentId', async () => {
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: {} }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/agentId/);
  });

  it('rejects invalid JSON', async () => {
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: '__invalid__' }));
    expect(res.status).toBe(400);
  });

  it('calls startChat mutation, runs welcome turn, returns shaped payload', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: {
        chatId: 'chat-1',
        systemMessage: 'Hello, I am your research assistant.',
        tools: [{ name: 'respond' }],
        conversationName: 'deep-dive',
        stageName: 'intro',
      },
    });
    mockRunChatTurn.mockResolvedValueOnce({
      assistantMessage: 'Welcome! What are we researching today?',
      stageTransitioned: false,
      newStageName: null,
      chatEnded: false,
    });

    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', conversationName: 'deep-dive' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toEqual({
      chatId: 'chat-1',
      conversationName: 'deep-dive',
      stageName: 'intro',
      welcomeMessage: 'Welcome! What are we researching today?',
      welcomeError: null,
      stageTransitioned: false,
      // Spec 017 — scope echoed back to the client. Default = private.
      scope: 'private',
    });

    // startChat called with forwarded args (conversationName defaults to null;
    // scope defaults to 'private' per FR-003)
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({ agentId: 'a1', conversationName: 'deep-dive', scope: 'private' });

    // runChatTurn called with startPayload for the welcome path
    expect(mockRunChatTurn).toHaveBeenCalledTimes(1);
    const runArgs = mockRunChatTurn.mock.calls[0][0];
    expect(runArgs.chatId).toBe('chat-1');
    expect(runArgs.userMessage).toBeNull();
    expect(runArgs.startPayload).toEqual({
      systemMessage: 'Hello, I am your research assistant.',
      tools: [{ name: 'respond' }],
    });
  });

  it('forwards appId + configName to the welcome runChatTurn (App chat picker)', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: { chatId: 'c', systemMessage: 's', tools: null, conversationName: null, stageName: null },
    });
    mockRunChatTurn.mockResolvedValueOnce({
      assistantMessage: 'hi',
      stageTransitioned: false,
      newStageName: null,
      chatEnded: false,
    });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1', appId: 'app-1', configName: 'bedrock-mm' } }));
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'a1', appId: 'app-1', configName: 'bedrock-mm' }),
    );
  });

  it('defaults conversationName to null when omitted', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: {
        chatId: 'c',
        systemMessage: '',
        tools: null,
        conversationName: null,
        stageName: null,
      },
    });
    mockRunChatTurn.mockResolvedValueOnce({
      assistantMessage: 'hi',
      stageTransitioned: false,
      newStageName: null,
      chatEnded: false,
    });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1' } }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ agentId: 'a1', conversationName: null, scope: 'private' });
  });

  it('forwards scope=shared when provided in the request body', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: {
        chatId: 'c-shared',
        systemMessage: '',
        tools: null,
        conversationName: 'family-meal',
        stageName: 'plan',
      },
    });
    mockRunChatTurn.mockResolvedValueOnce({
      assistantMessage: '',
      stageTransitioned: false,
      newStageName: null,
      chatEnded: false,
    });
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', scope: 'shared' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.scope).toBe('shared');
    expect(mockRequest.mock.calls[0][1]).toEqual({
      agentId: 'a1',
      conversationName: null,
      scope: 'shared',
    });
  });

  it('coerces unknown scope values to private (safe default)', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: { chatId: 'x', systemMessage: '', tools: null, conversationName: null, stageName: null },
    });
    mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: '', stageTransitioned: false, newStageName: null, chatEnded: false });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1', scope: 'public' } as any }));
    expect(mockRequest.mock.calls[0][1].scope).toBe('private');
  });

  it('returns 400 with shared-chat-requires-app-context when the server rejects a shared chat (English fallback)', async () => {
    mockRequest.mockRejectedValueOnce(
      new Error("Cannot create a shared chat — you are not a member of any App that installs this Agent."),
    );
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', scope: 'shared' } }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toBe('shared-chat-requires-app-context');
    expect(body.message).toMatch(/requires membership/i);
  });

  // hadron-server's `ChatScopeError` extends GraphQLError so Apollo
  // emits `extensions.code` on the wire. Reading it is more reliable
  // than substring-matching English messages — covered by the test
  // below — but the English fallback above is kept as defense in depth.
  it('returns 400 with shared-chat-requires-app-context via extensions.code (primary path)', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('msg-from-server'), {
        response: {
          errors: [
            {
              message: 'msg-from-server',
              extensions: { code: 'SHARED_CHAT_REQUIRES_APP_CONTEXT' },
            },
          ],
        },
      }),
    );
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', scope: 'shared' } }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('shared-chat-requires-app-context');
  });

  it('returns 400 with shared-chat-not-available-for-app-sessions via extensions.code', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('msg-from-server'), {
        response: {
          errors: [
            {
              message: 'msg-from-server',
              extensions: { code: 'SHARED_CHAT_NOT_AVAILABLE_FOR_APP_SESSIONS' },
            },
          ],
        },
      }),
    );
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', scope: 'shared' } }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('shared-chat-not-available-for-app-sessions');
  });

  it('returns 400 for app-session-shared via the English fallback (extensions.code absent)', async () => {
    mockRequest.mockRejectedValueOnce(
      new Error("Shared chats are not available for MCP App-key sessions — start the chat from a signed-in user surface."),
    );
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1', scope: 'shared' } }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('shared-chat-not-available-for-app-sessions');
  });

  // Scope-coercion edge cases. The load-bearing safety property here is
  // that `body.scope === 'shared'` is the ONLY input that produces
  // shared; anything else (including capitalization variants, null,
  // undefined, and bogus values) coerces to 'private'.
  it('coerces undefined scope to private', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: { chatId: 'x', systemMessage: '', tools: null, conversationName: null, stageName: null },
    });
    mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: '', stageTransitioned: false, newStageName: null, chatEnded: false });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1' } })); // scope omitted
    expect(mockRequest.mock.calls[0][1].scope).toBe('private');
  });

  it('coerces null scope to private', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: { chatId: 'x', systemMessage: '', tools: null, conversationName: null, stageName: null },
    });
    mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: '', stageTransitioned: false, newStageName: null, chatEnded: false });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1', scope: null } as any }));
    expect(mockRequest.mock.calls[0][1].scope).toBe('private');
  });

  it('coerces capitalization variants (Shared, SHARED) to private', async () => {
    mockRequest.mockResolvedValue({
      startChat: { chatId: 'x', systemMessage: '', tools: null, conversationName: null, stageName: null },
    });
    mockRunChatTurn.mockResolvedValue({ assistantMessage: '', stageTransitioned: false, newStageName: null, chatEnded: false });
    const { POST } = await import('./start/+server');
    await POST(ev({ body: { agentId: 'a1', scope: 'Shared' } as any }));
    expect(mockRequest.mock.calls[0][1].scope).toBe('private');
    await POST(ev({ body: { agentId: 'a1', scope: 'SHARED' } as any }));
    expect(mockRequest.mock.calls[1][1].scope).toBe('private');
  });

  it('returns 500 when startChat mutation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('graphql boom'));
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1' } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe('Chat request failed. Please try again.');
  });

  it('never echoes an unexpected start error or failed welcome to JSON or logs', async () => {
    const sentinel = 'sk-synthetic-966';
    mockRequest.mockRejectedValueOnce(new Error(`Authorization: Bearer ${sentinel}`));
    const { POST } = await import('./start/+server');
    const rejected = await POST(ev({ body: { agentId: 'a1' } }));
    expect(JSON.stringify(await jsonOf(rejected))).not.toContain(sentinel);

    mockRequest.mockResolvedValueOnce({ startChat: {
      chatId: 'c', systemMessage: '', tools: null, conversationName: null, stageName: null,
    } });
    mockRunChatTurn.mockRejectedValueOnce(new Error(`Authorization: Bearer ${sentinel}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const created = await POST(ev({ body: { agentId: 'a1' } }));
      expect(created.status).toBe(200);
      expect(JSON.stringify(await jsonOf(created))).not.toContain(sentinel);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
    } finally {
      warn.mockRestore();
    }
  });

  // Spec 016 — welcome turn is best-effort. startChat must succeed and
  // the chat must be created, but a failed welcome turn (e.g. agent
  // has no conversations configured, missing LLM key, LLM error) must
  // NOT 500 the whole call or leave an orphan chat node. The caller
  // gets the chatId plus a soft welcomeError hint and proceeds.
  it('returns 200 with welcomeError when the welcome turn fails (spec 016)', async () => {
    mockRequest.mockResolvedValueOnce({
      startChat: {
        chatId: 'chat-orphan-avoided',
        systemMessage: '',
        tools: null,
        conversationName: null,
        stageName: null,
      },
    });
    mockRunChatTurn.mockRejectedValueOnce(
      new (await import('$lib/server/llm/chatError.js')).ChatError('noConfig'),
    );
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chatId).toBe('chat-orphan-avoided');
    expect(body.welcomeMessage).toBeNull();
    expect(body.welcomeError).toMatch(/no LLM provider/);
    expect(body.stageTransitioned).toBe(false);
  });
});

// ── /api/agent-chat/turn ───────────────────────────────────────────────────

describe('POST /api/agent-chat/turn', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ token: null, body: { agentId: 'a', chatId: 'c', userMessage: 'x' } }));
    expect(res.status).toBe(401);
  });

  it('requires agentId, chatId, and userMessage', async () => {
    const { POST } = await import('./turn/+server');
    for (const bad of [
      {},
      { agentId: 'a' },
      { agentId: 'a', chatId: 'c' },
      { agentId: 'a', userMessage: 'x' },
    ]) {
      const res = await POST(ev({ body: bad }));
      expect(res.status).toBe(400);
    }
  });

  it('delegates to runChatTurn and returns its result verbatim', async () => {
    const turn = {
      assistantMessage: 'The capital of France is Paris.',
      stageTransitioned: true,
      newStageName: 'facts',
      conversationHandoff: null,
      chatEnded: false,
      onTrack: true,
      offTrackReason: null,
      usage: { inputTokens: 42, outputTokens: 13 },
    };
    mockRunChatTurn.mockResolvedValueOnce(turn);
    const { POST } = await import('./turn/+server');
    const res = await POST(
      ev({ body: { agentId: 'a1', chatId: 'chat-9', userMessage: 'capital of France?' } }),
    );
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual(turn);
    expect(mockRunChatTurn).toHaveBeenCalledWith({
      token: 'test-token',
      agentId: 'a1',
      chatId: 'chat-9',
      userMessage: 'capital of France?',
    });
  });

  it('forwards appId + configName to runChatTurn (App chat picker)', async () => {
    mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: 'hi' });
    const { POST } = await import('./turn/+server');
    await POST(
      ev({ body: { agentId: 'a1', chatId: 'c1', userMessage: 'hi', appId: 'app-1', configName: 'bedrock-mm' } }),
    );
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'a1', chatId: 'c1', appId: 'app-1', configName: 'bedrock-mm' }),
    );
  });

  it('returns 500 with error message on LLM failure', async () => {
    mockRunChatTurn.mockRejectedValueOnce(new Error('provider timeout'));
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ body: { agentId: 'a', chatId: 'c', userMessage: 'x' } }));
    expect(res.status).toBe(500);
    expect(await jsonOf(res)).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
  });

  it('keeps unexpected provider text out of a turn response', async () => {
    mockRunChatTurn.mockRejectedValueOnce(new Error('Authorization: Bearer sk-synthetic-966'));
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ body: { agentId: 'a', chatId: 'c', userMessage: 'x' } }));
    expect(await jsonOf(res)).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
  });

  it('includes conversationHandoff and onTrack in the response', async () => {
    const turn = {
      assistantMessage: 'Switching to strategy mode.',
      stageTransitioned: true,
      newStageName: 'diagnose',
      conversationHandoff: 'strategy',
      chatEnded: false,
      onTrack: false,
      offTrackReason: 'User wants strategy, not onboarding',
      usage: { inputTokens: 50, outputTokens: 20 },
    };
    mockRunChatTurn.mockResolvedValueOnce(turn);
    const { POST } = await import('./turn/+server');
    const res = await POST(
      ev({ body: { agentId: 'a1', chatId: 'c1', userMessage: 'help with strategy' } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.conversationHandoff).toBe('strategy');
    expect(body.onTrack).toBe(false);
    expect(body.offTrackReason).toBe('User wants strategy, not onboarding');
  });
});

// ── /api/agent-chat/resume ─────────────────────────────────────────────────

describe('POST /api/agent-chat/resume', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ token: null, body: { agentId: 'a', chatId: 'c' } }));
    expect(res.status).toBe(401);
  });

  it('requires agentId and chatId', async () => {
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'a' } }));
    expect(res.status).toBe(400);
  });

  it('loads chat metadata + history in parallel and returns both', async () => {
    mockRequest
      .mockResolvedValueOnce({
        myChats: [
          { loc: 'chat-abc', title: 'Other', lastMessageAt: '2026-04-10' },
          { loc: 'chat-123', title: 'Resume me', lastMessageAt: '2026-04-15' },
        ],
      })
      .mockResolvedValueOnce({
        chatHistory: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      });
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'a1', chatId: 'chat-123' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chat.loc).toBe('chat-123');
    expect(body.messages).toHaveLength(2);
    // #793: a bounded tail page, not a 500-message guess. `beforeSeq: null` is
    // sent explicitly — the server treats null and absent alike, so the tail
    // read and the paged read use one variable set.
    expect(mockRequest.mock.calls[1][1]).toEqual({
      chatId: 'chat-123',
      limit: AGENT_CHAT_PAGE_SIZE,
      beforeSeq: null,
    });
  });

  it('returns 404 when the chat is not in myChats (ownership/nonexistent)', async () => {
    mockRequest
      .mockResolvedValue({ myChats: [] })
      .mockResolvedValueOnce({ myChats: [{ loc: 'chat-other' }] })
      .mockResolvedValueOnce({ chatHistory: [] });
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'a', chatId: 'chat-missing' } }));
    expect(res.status).toBe(404);
  });

  // Spec 016 — regression test for the "chats disappear on reload" symptom.
  // Reload is simulated by calling /resume directly: the portal UI does the
  // same thing on mount. The contract being pinned: /resume returns the full
  // chat metadata AND the prior messages in seq order, so the UI never needs to
  // reconstruct history from client-side state.
  //
  // #793 narrowed one word of that contract, so it is worth being exact: the
  // history is now the newest PAGE rather than the whole transcript. What this
  // test guards is unaffected — a 6-message chat is a single page, and the
  // symptom was an EMPTY pane, not a short one. Anything before the page is
  // reachable by scrolling (`hasOlder` + /older), which is a different promise
  // than "history is client-side state" and does not weaken this one.
  it('returns full chat metadata + message history in order on resume (spec 016 regression)', async () => {
    const chatId = 'chat-016-regression';
    const allChats = [
      {
        loc: chatId,
        title: "Alice's pizza",
        conversationName: 'greet',
        stageName: 'confirm',
        messageCount: 6,
        lastMessageAt: '2026-05-11T10:00:00Z',
      },
    ];
    const fullHistory = [
      { role: 'assistant', content: "Hi! What's your name?", seq: 1, createdAt: '2026-05-11T09:55:00Z' },
      { role: 'user', content: 'Alice', seq: 2, createdAt: '2026-05-11T09:55:30Z' },
      { role: 'assistant', content: 'Hi Alice, what size?', seq: 3, createdAt: '2026-05-11T09:56:00Z' },
      { role: 'user', content: 'medium', seq: 4, createdAt: '2026-05-11T09:56:30Z' },
      { role: 'assistant', content: 'Got it — medium for Alice.', seq: 5, createdAt: '2026-05-11T09:57:00Z' },
      { role: 'user', content: 'thanks', seq: 6, createdAt: '2026-05-11T09:57:30Z' },
    ];
    mockRequest
      .mockResolvedValueOnce({ myChats: allChats })
      .mockResolvedValueOnce({ chatHistory: fullHistory });
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'a1', chatId } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chat.loc).toBe(chatId);
    expect(body.chat.messageCount).toBe(6);
    expect(body.chat.stageName).toBe('confirm');
    expect(body.messages).toHaveLength(6);
    expect(body.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.messages[0].role).toBe('assistant');
    expect(body.messages[5].content).toBe('thanks');
  });

  // #793 — the flag that tells the client a scroll-up has somewhere to go.
  it('reports hasOlder when the tail page comes back full', async () => {
    mockRequest
      .mockResolvedValueOnce({ myChats: [{ loc: 'c' }] })
      .mockResolvedValueOnce({ chatHistory: page(AGENT_CHAT_PAGE_SIZE, 401) });
    const { POST } = await import('./resume/+server');
    const body = await jsonOf(await POST(ev({ body: { agentId: 'a', chatId: 'c' } })));
    expect(body.hasOlder).toBe(true);
  });

  it('reports hasOlder false for a chat shorter than one page', async () => {
    mockRequest
      .mockResolvedValueOnce({ myChats: [{ loc: 'c' }] })
      .mockResolvedValueOnce({ chatHistory: page(3, 1) });
    const { POST } = await import('./resume/+server');
    const body = await jsonOf(await POST(ev({ body: { agentId: 'a', chatId: 'c' } })));
    expect(body.hasOlder).toBe(false);
  });
});

// ── /api/agent-chat/older ──────────────────────────────────────────────────

describe('POST /api/agent-chat/older (#793 scrollback)', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ token: null, body: { chatId: 'c', beforeSeq: 5 } }));
    expect(res.status).toBe(401);
  });

  // A non-string chatId used to survive to the GraphQL layer and fail there as
  // a variable-type error — a 500 for what is plainly bad client input
  // (@copilot on PR #801).
  it.each([
    ['missing', {}],
    ['empty', { chatId: '' }],
    ['an object', { chatId: { toString: () => 'c' } }],
    ['a number', { chatId: 42 }],
    ['an array', { chatId: ['c'] }],
  ])('rejects a chatId that is %s', async (_label, extra) => {
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { beforeSeq: 5, ...extra } }));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['a string', { beforeSeq: '5' }],
    ['a float', { beforeSeq: 5.5 }],
    ['null', { beforeSeq: null }],
  ])('rejects a beforeSeq that is %s', async (_label, extra) => {
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { chatId: 'c', ...extra } }));
    expect(res.status).toBe(400);
    // Rejected HERE, not passed through to fail as a GraphQL variable error the
    // client cannot read.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // `!beforeSeq` would reject this one — the cursor that reaches the very first
  // message of a chat whose counter starts at 0.
  it('accepts a beforeSeq of 0', async () => {
    mockRequest.mockResolvedValueOnce({ chatHistory: [] });
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { chatId: 'c', beforeSeq: 0 } }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ beforeSeq: 0 });
  });

  it('passes the cursor through and returns the page oldest-first', async () => {
    mockRequest.mockResolvedValueOnce({ chatHistory: page(10, 21) });
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { chatId: 'chat-x', beforeSeq: 31 } }));
    const body = await jsonOf(res);
    expect(mockRequest.mock.calls[0][1]).toEqual({
      chatId: 'chat-x',
      limit: AGENT_CHAT_PAGE_SIZE,
      beforeSeq: 31,
    });
    expect(body.messages.map((m: { seq: number }) => m.seq)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);
  });

  // An exhausted cursor is a normal outcome, not an error: the client stops on
  // `hasOlder`, and a 4xx here would show a reader an error for reaching the
  // beginning of their own conversation.
  it('returns an empty page with hasOlder false past the beginning', async () => {
    mockRequest.mockResolvedValueOnce({ chatHistory: [] });
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { chatId: 'c', beforeSeq: 1 } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.messages).toEqual([]);
    expect(body.hasOlder).toBe(false);
  });

  it('surfaces a GraphQL failure as a 500 the client can show', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await import('./older/+server');
    const res = await POST(ev({ body: { chatId: 'c', beforeSeq: 9 } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBeTruthy();
  });

  // The reason this endpoint exists rather than a `beforeSeq` mode on /resume:
  // scrolling must not re-run the chat-metadata read, whose 404 branch makes
  // the component clear `activeChatId` and drop the open conversation (#785).
  it('does not read chat metadata', async () => {
    mockRequest.mockResolvedValueOnce({ chatHistory: page(2, 1) });
    const { POST } = await import('./older/+server');
    await POST(ev({ body: { chatId: 'c', beforeSeq: 3 } }));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(String(mockRequest.mock.calls[0][0])).toContain('chatHistory');
    expect(String(mockRequest.mock.calls[0][0])).not.toContain('myChats');
  });
});

// ── /api/agent-chat/list ───────────────────────────────────────────────────

describe('GET /api/agent-chat/list', () => {
  beforeEach(() => { mockRequest.mockResolvedValue({ myChats: [] }); });
  it('rejects unauthenticated requests', async () => {
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ token: null, searchParams: { agentId: 'a' } }));
    expect(res.status).toBe(401);
  });

  it('requires agentId query param', async () => {
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: {} }));
    expect(res.status).toBe(400);
  });

  it('returns the myChats list under a `chats` key', async () => {
    const chats = [{ loc: 'c1' }, { loc: 'c2' }];
    mockRequest.mockResolvedValueOnce({ myChats: chats });
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'a1' } }));
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ chats });
    // The endpoint's query param stays `agentId`, but it forwards the server's
    // renamed `agentRef` arg (8032d99: read-surface <entity>Id → <entity>Ref).
    expect(mockRequest.mock.calls[0][1]).toEqual({ agentRef: 'a1', limit: 100, offset: 0 });
  });

  // Spec 016 — pins the list contract the UI sidebar relies on.
  // Each chat entry MUST carry the fields the sidebar renders
  // (title, messageCount, lastMessageAt) so a reload-restored list
  // is indistinguishable from a freshly-built one. Ordering is the
  // server's responsibility (myChats resolver); this test confirms
  // the portal's pass-through preserves it.
  it('passes through myChats order and exposes all fields the UI sidebar needs (spec 016)', async () => {
    const chats = [
      {
        loc: 'chat-newer',
        title: 'Newer',
        conversationName: 'greet',
        stageName: 'confirm',
        messageCount: 4,
        lastMessageAt: '2026-05-11T10:00:00Z',
      },
      {
        loc: 'chat-older',
        title: 'Older',
        conversationName: 'greet',
        stageName: 'ask-size',
        messageCount: 2,
        lastMessageAt: '2026-05-10T10:00:00Z',
      },
    ];
    mockRequest.mockResolvedValueOnce({ myChats: chats });
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chats).toHaveLength(2);
    expect(body.chats[0].loc).toBe('chat-newer');
    expect(body.chats[0].title).toBe('Newer');
    expect(body.chats[0].messageCount).toBe(4);
    expect(body.chats[0].lastMessageAt).toBe('2026-05-11T10:00:00Z');
    expect(body.chats[1].loc).toBe('chat-older');
  });

  // A team App's chat lives at the canonical loc `chats:team` (server #939) in
  // the same app-class memory `myChats` scans, so the resolver hands it back
  // as if it were an agent conversation. Rendering it in this list hands the
  // agent-chat surface — LLM composer, rename, delete-with-all-messages — a
  // thread of real teammate posts. Filtered here until the resolver excludes
  // it server-side.
  it('excludes the canonical team chat from the agent-chat list', async () => {
    mockRequest.mockResolvedValueOnce({
      myChats: [
        { loc: 'chats:team', title: 'First post — human-authored', scope: 'shared' },
        { loc: 'chats:11111111-2222-3333-4444-555555555555', title: 'Real chat', scope: 'shared' },
      ],
    });
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chats.map((c: { loc: string }) => c.loc)).toEqual([
      'chats:11111111-2222-3333-4444-555555555555',
    ]);
  });

  // The negative case for the filter above (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail):
  // the exclusion must key on the EXACT canonical loc, so a user chat whose loc
  // merely starts with it keeps showing up. A `startsWith` implementation passes
  // the test above and fails this one.
  it('keeps a chat whose loc only starts with the team-chat loc', async () => {
    mockRequest.mockResolvedValueOnce({
      myChats: [{ loc: 'chats:team-retro', title: 'Retro' }],
    });
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'a1' } }));
    expect((await jsonOf(res)).chats.map((c: { loc: string }) => c.loc)).toEqual([
      'chats:team-retro',
    ]);
  });
});

// ── /api/agent-chat/title ──────────────────────────────────────────────────

describe('POST /api/agent-chat/title', () => {
  it('requires chatId and title', async () => {
    const { POST } = await import('./title/+server');
    const res = await POST(ev({ body: { chatId: 'c' } }));
    expect(res.status).toBe(400);
  });

  it('forwards to the update mutation', async () => {
    mockRequest.mockResolvedValueOnce({ updateChatTitle: { id: 'c', title: 'New' } });
    const { POST } = await import('./title/+server');
    const res = await POST(ev({ body: { chatId: 'c', title: 'New' } }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toEqual({ chatId: 'c', title: 'New' });
  });
});

// ── /api/agent-chat/delete ─────────────────────────────────────────────────

describe('POST /api/agent-chat/delete', () => {
  it('requires chatId', async () => {
    const { POST } = await import('./delete/+server');
    const res = await POST(ev({ body: {} }));
    expect(res.status).toBe(400);
  });

  it('forwards to the delete mutation', async () => {
    mockRequest.mockResolvedValueOnce({ deleteChat: true });
    const { POST } = await import('./delete/+server');
    const res = await POST(ev({ body: { chatId: 'c' } }));
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).ok).toBe(true);
    expect(mockRequest.mock.calls[0][1]).toEqual({ chatId: 'c' });
  });

  it('returns 500 when the mutation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('fk violation'));
    const { POST } = await import('./delete/+server');
    const res = await POST(ev({ body: { chatId: 'c' } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe('fk violation');
  });
});

// 036-ai-service-config: the legacy POST /api/agent-chat/ai-config endpoint was
// removed; named-config CRUD + Test now live at /api/ai-configs (see
// src/routes/api/ai-configs/server.test.ts).

// #1224: model the server's default 100-row window instead of returning an
// unconditional complete list. Preserve private/shared rows and server order.
describe('agent chat metadata past the first page (#1224)', () => {
  function serveChats(count: number, failOffset?: number, cap = 100) {
    const chats = Array.from({ length: count }, (_, i) => ({
      id: `node-${i}`, loc: `chats:${i}`, title: `Chat ${i}`,
      scope: i % 2 ? 'shared' : 'private',
    }));
    mockRequest.mockImplementation(async (document: string, vars: Record<string, any>) => {
      if (document.includes('query MyChats')) {
        expect(vars.agentRef).toBe('agent-pages');
        if (failOffset != null && vars.offset >= failOffset) throw new Error('Later page unavailable');
        return { myChats: chats.slice(vars.offset ?? 0, (vars.offset ?? 0) + Math.min(vars.limit ?? 100, cap)) };
      }
      return { chatHistory: [{ role: 'user', content: 'Existing history', seq: 1 }] };
    });
    return chats;
  }
  it.each([0, 99, 100, 101, 205])('lists all %s chats in server order', async count => {
    const chats = serveChats(count);
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'agent-pages' } }));
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).chats).toEqual(chats);
    const pages = mockRequest.mock.calls.map(([, vars]) => vars);
    expect(pages.every(vars => vars.limit === 100 && Number.isInteger(vars.offset))).toBe(true);
  });
  it.each([0, 99, 100, 204])('resumes chat at zero-based position %s', async index => {
    const chats = serveChats(205);
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'agent-pages', chatId: chats[index].loc } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chat).toEqual(chats[index]);
    expect(body.messages[0].content).toBe('Existing history');
    const reads = mockRequest.mock.calls.filter(([doc]) => String(doc).includes('query MyChats'));
    expect(reads).toHaveLength(Math.floor(index / 100) + 1);
  });
  it.each(['list', 'resume'])('continues through short nonempty capped pages for %s', async route => {
    const chats = serveChats(205, undefined, 37);
    const res = route === 'list'
      ? await (await import('./list/+server')).GET(ev({ searchParams: { agentId: 'agent-pages' } }))
      : await (await import('./resume/+server')).POST(ev({ body: { agentId: 'agent-pages', chatId: 'chats:204' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    if (route === 'list') expect(body.chats).toEqual(chats);
    else expect(body.chat).toEqual(chats[204]);
    const offsets = mockRequest.mock.calls.filter(([doc]) => String(doc).includes('query MyChats')).map(([, vars]) => vars.offset);
    expect(offsets).toEqual(route === 'list' ? [0, 37, 74, 111, 148, 185, 205] : [0, 37, 74, 111, 148, 185]);
  });
  it('keeps the first occurrence of a loc when chats shift across offset pages', async () => {
    const chats = serveChats(101);
    let metadataReads = 0;
    const normalRead = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (document: string, vars: Record<string, any>) => {
      if (document.includes('query MyChats')) {
        metadataReads++;
        if (metadataReads === 2) {
          // The oldest chat was updated between reads and moved to the front.
          // Row99 shifts to offset100; changing its payload pins first-wins.
          return { myChats: [{ ...chats[99], title: 'Later duplicate' }] };
        }
        if (metadataReads > 2) return { myChats: [] };
      }
      return normalRead(document, vars);
    });
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'agent-pages' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.chats).toEqual(chats.slice(0, 100));
    expect(new Set(body.chats.map((chat: { loc: string }) => chat.loc)).size).toBe(body.chats.length);
    expect(mockRequest.mock.calls.map(([, vars]) => vars.offset)).toEqual([0, 100, 101]);
  });
  it('returns not found only after exhausting authorized metadata', async () => {
    serveChats(205);
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'agent-pages', chatId: 'chats:absent' } }));
    expect(res.status).toBe(404);
    expect(mockRequest.mock.calls.filter(([doc]) => String(doc).includes('query MyChats'))).toHaveLength(4);
  });
  it.each(['list', 'resume'])('propagates a later page failure for %s instead of partial success/not found', async route => {
    serveChats(205, 100);
    const res = route === 'list'
      ? await (await import('./list/+server')).GET(ev({ searchParams: { agentId: 'agent-pages' } }))
      : await (await import('./resume/+server')).POST(ev({ body: { agentId: 'agent-pages', chatId: 'chats:204' } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe('Later page unavailable');
  });
  it('continues after a full page containing the excluded team chat', async () => {
    const chats = serveChats(101);
    chats[0].loc = 'chats:team';
    const { GET } = await import('./list/+server');
    const res = await GET(ev({ searchParams: { agentId: 'agent-pages' } }));
    expect((await jsonOf(res)).chats).toEqual(chats.slice(1));
  });
});
