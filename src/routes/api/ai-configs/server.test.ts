/**
 * Tests for the generic /api/ai-configs endpoint (036-ai-service-config).
 *
 * Strategy mirrors agent-chat.test.ts: mock `$lib/server/api` (the GraphQL
 * client) and `$lib/server/llm/agentChatLlm` (callAgentChatLlm), import the
 * POST handler, and invoke it with a hand-rolled RequestEvent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

const mockCallAgentChatLlm = vi.fn();
vi.mock('$lib/server/llm/agentChatLlm', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));
vi.mock('$lib/server/llm/agentChatLlm.js', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));

function ev(opts: { token?: string | null; body?: unknown }) {
  const token = opts.token === undefined ? 'test-token' : opts.token;
  return {
    request: { json: async () => opts.body },
    locals: { token },
    url: new URL('http://localhost/api/ai-configs'),
  } as any;
}

async function jsonOf(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

beforeEach(() => {
  mockRequest.mockReset();
  mockCallAgentChatLlm.mockReset();
});

describe('POST /api/ai-configs', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ token: null, body: { action: 'create' } }));
    expect(res.status).toBe(401);
  });

  it('create: requires the core fields', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'create', ownerType: 'ORGANIZATION', ownerId: 'o1' } }));
    expect(res.status).toBe(400);
  });

  it('create: forwards op + variables and returns the config', async () => {
    mockRequest.mockResolvedValueOnce({ createAiServiceConfig: { id: 'c1', name: 'default' } });
    const { POST } = await import('./+server');
    const res = await POST(
      ev({
        body: {
          action: 'create',
          ownerType: 'ORGANIZATION',
          ownerId: 'o1',
          name: 'default',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-x',
          enabled: true,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.config.id).toBe('c1');
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      ownerType: 'ORGANIZATION',
      ownerId: 'o1',
      name: 'default',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: 'sk-ant-x',
      enabled: true,
    });
  });

  it('create: omits apiKey when none is provided (stored without a key)', async () => {
    mockRequest.mockResolvedValueOnce({ createAiServiceConfig: { id: 'c2' } });
    const { POST } = await import('./+server');
    await POST(
      ev({ body: { action: 'create', ownerType: 'AGENT', ownerId: 'a1', name: 'fast', provider: 'openai', model: 'gpt-4o' } }),
    );
    expect(mockRequest.mock.calls[0][1].apiKey).toBeUndefined();
  });

  it('update: apiKeyAction "keep" omits apiKey', async () => {
    mockRequest.mockResolvedValueOnce({ updateAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'update', id: 'c1', model: 'gpt-4o', apiKeyAction: 'keep' } }));
    expect(mockRequest.mock.calls[0][1].apiKey).toBeUndefined();
    expect(mockRequest.mock.calls[0][1].model).toBe('gpt-4o');
  });

  it('update: apiKeyAction "clear" sends an empty string', async () => {
    mockRequest.mockResolvedValueOnce({ updateAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'update', id: 'c1', apiKeyAction: 'clear' } }));
    expect(mockRequest.mock.calls[0][1].apiKey).toBe('');
  });

  it('update: apiKeyAction "set" sends the new key', async () => {
    mockRequest.mockResolvedValueOnce({ updateAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'update', id: 'c1', apiKeyAction: 'set', apiKey: 'sk-new' } }));
    expect(mockRequest.mock.calls[0][1].apiKey).toBe('sk-new');
  });

  it('delete: requires id and forwards it', async () => {
    const { POST } = await import('./+server');
    expect((await POST(ev({ body: { action: 'delete' } }))).status).toBe(400);

    mockRequest.mockResolvedValueOnce({ deleteAiServiceConfig: true });
    const res = await POST(ev({ body: { action: 'delete', id: 'c9' } }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'c9' });
  });

  it('surfaces the server error message (e.g. duplicate name)', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'A config named "default" already exists for this owner.' }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(
      ev({ body: { action: 'create', ownerType: 'ORGANIZATION', ownerId: 'o1', name: 'default', provider: 'openai', model: 'gpt-4o' } }),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/already exists/);
  });

  it('test (inline): forwards the in-form key to the LLM and returns the reply', async () => {
    mockCallAgentChatLlm.mockResolvedValueOnce({
      respond: { message: 'I am here.' },
      rawText: 'I am here.',
      usage: { inputTokens: 5, outputTokens: 4 },
    });
    const { POST } = await import('./+server');
    const res = await POST(
      ev({ body: { action: 'test', provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-x' } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.reply).toBe('I am here.');
    const llmArgs = mockCallAgentChatLlm.mock.calls[0][0];
    expect(llmArgs.apiKey).toBe('sk-x');
    expect(llmArgs.tools).toBeNull();
    // No GraphQL needed for the inline path.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('test (saved): resolves the decrypted key server-side, then calls the LLM', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveAIConfig: { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-resolved' },
    });
    mockCallAgentChatLlm.mockResolvedValueOnce({ respond: { message: 'hi' }, rawText: 'hi', usage: {} });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'test', name: 'default', agentId: 'a1' } }));
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).ok).toBe(true);
    // Input body keeps `agentId`, but it's forwarded as the server's renamed
    // `agentRef` arg (8032d99: read-surface <entity>Id → <entity>Ref).
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ name: 'default', agentRef: 'a1' });
    expect(mockCallAgentChatLlm.mock.calls[0][0].apiKey).toBe('sk-resolved');
  });

  it('test: surfaces LLM errors as ok:false (HTTP 200)', async () => {
    mockCallAgentChatLlm.mockRejectedValueOnce(new Error('401 invalid api key'));
    const { POST } = await import('./+server');
    const res = await POST(
      ev({ body: { action: 'test', provider: 'anthropic', model: 'claude-x', apiKey: 'bad' } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid api key/);
  });

  it('rejects unknown actions', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'explode' } }));
    expect(res.status).toBe(400);
  });
});
