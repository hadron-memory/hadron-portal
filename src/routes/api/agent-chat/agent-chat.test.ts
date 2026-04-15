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
      stageTransitioned: false,
    });

    // startChat called with forwarded args (conversationName defaults to null)
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({ agentId: 'a1', conversationName: 'deep-dive' });

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
    expect(mockRequest.mock.calls[0][1]).toEqual({ agentId: 'a1', conversationName: null });
  });

  it('returns 500 when startChat mutation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('graphql boom'));
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ body: { agentId: 'a1' } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe('graphql boom');
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
      chatEnded: false,
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

  it('returns 500 with error message on LLM failure', async () => {
    mockRunChatTurn.mockRejectedValueOnce(new Error('provider timeout'));
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ body: { agentId: 'a', chatId: 'c', userMessage: 'x' } }));
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe('provider timeout');
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
    // second request was chatHistory with the passed chatId + default limit
    expect(mockRequest.mock.calls[1][1]).toEqual({ chatId: 'chat-123', limit: 500 });
  });

  it('returns 404 when the chat is not in myChats (ownership/nonexistent)', async () => {
    mockRequest
      .mockResolvedValueOnce({ myChats: [{ loc: 'chat-other' }] })
      .mockResolvedValueOnce({ chatHistory: [] });
    const { POST } = await import('./resume/+server');
    const res = await POST(ev({ body: { agentId: 'a', chatId: 'chat-missing' } }));
    expect(res.status).toBe(404);
  });
});

// ── /api/agent-chat/list ───────────────────────────────────────────────────

describe('GET /api/agent-chat/list', () => {
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
    expect(mockRequest.mock.calls[0][1]).toEqual({ agentId: 'a1' });
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

// ── /api/agent-chat/ai-config ──────────────────────────────────────────────

describe('POST /api/agent-chat/ai-config', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ token: null, body: { agentId: 'a' } }));
    expect(res.status).toBe(401);
  });

  it('save: requires provider, model, apiKey', async () => {
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'save', agentId: 'a', provider: 'openai' } }));
    expect(res.status).toBe(400);
  });

  it('save: forwards to UPDATE_AGENT_AI_CONFIG_MUTATION', async () => {
    mockRequest.mockResolvedValueOnce({ updateAgentAIConfig: true });
    const { POST } = await import('./ai-config/+server');
    const res = await POST(
      ev({
        body: {
          action: 'save',
          agentId: 'a1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          apiKey: 'sk-ant-xxx',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toEqual({
      agentId: 'a1',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'sk-ant-xxx',
    });
  });

  it('clear: forwards to CLEAR_AGENT_AI_CONFIG_MUTATION', async () => {
    mockRequest.mockResolvedValueOnce({ clearAgentAIConfig: true });
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'clear', agentId: 'a1' } }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toEqual({ agentId: 'a1' });
  });

  it('test: reports "no config saved" when agentAIConfig is null', async () => {
    mockRequest.mockResolvedValueOnce({ agentAIConfig: null });
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'test', agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No AI config/);
    expect(mockCallAgentChatLlm).not.toHaveBeenCalled();
  });

  it('test: calls the LLM and returns the reply on success', async () => {
    mockRequest.mockResolvedValueOnce({
      agentAIConfig: { provider: 'openai', apiKey: 'sk-xxx', model: 'gpt-4o-mini' },
    });
    mockCallAgentChatLlm.mockResolvedValueOnce({
      respond: { message: 'I am here.' },
      rawText: 'I am here.',
      usage: { inputTokens: 5, outputTokens: 4 },
    });
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'test', agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.reply).toBe('I am here.');
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o-mini');

    // Forwarded the decrypted config to the LLM and forced plain-text (tools: null)
    const llmArgs = mockCallAgentChatLlm.mock.calls[0][0];
    expect(llmArgs.provider).toBe('openai');
    expect(llmArgs.apiKey).toBe('sk-xxx');
    expect(llmArgs.model).toBe('gpt-4o-mini');
    expect(llmArgs.tools).toBeNull();
  });

  it('test: surfaces LLM errors as ok:false (HTTP 200)', async () => {
    mockRequest.mockResolvedValueOnce({
      agentAIConfig: { provider: 'anthropic', apiKey: 'bad', model: 'claude-x' },
    });
    mockCallAgentChatLlm.mockRejectedValueOnce(new Error('401 invalid api key'));
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'test', agentId: 'a1' } }));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid api key/);
  });

  it('rejects unknown actions', async () => {
    const { POST } = await import('./ai-config/+server');
    const res = await POST(ev({ body: { action: 'explode', agentId: 'a1' } }));
    expect(res.status).toBe(400);
  });
});
