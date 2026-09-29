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

  it('maps a typed duplicate-name error without echoing the server message', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'A config named "default" already exists for this owner.', extensions: { code: 'DuplicateAiServiceConfigNameError' } }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(
      ev({ body: { action: 'create', ownerType: 'ORGANIZATION', ownerId: 'o1', name: 'default', provider: 'openai', model: 'gpt-4o' } }),
    );
    expect(res.status).toBe(409);
    expect((await jsonOf(res)).error).toMatch(/already exists/);
  });

  const configWrites = [
    { action: 'create', ownerType: 'ORGANIZATION', ownerId: 'o1', name: 'default', provider: 'openai', model: 'gpt-4o' },
    { action: 'update', id: 'c1', params: { temperature: 3 } },
  ];

  it.each(configWrites)('$action: maps typed validation to a safe 400', async (body) => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Authorization: Bearer sk-synthetic-966', extensions: { code: 'AiConfigValidationError' } }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body }));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({
      error: 'AI configuration is invalid. Check the name, provider settings, model, and API key.',
    });
  });

  it.each(configWrites)('$action: keeps an unknown GraphQL error generic', async (body) => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Authorization: Bearer sk-synthetic-966', extensions: { code: 'UNKNOWN_ERROR' } }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body }));
    expect(res.status).toBe(500);
    expect(await jsonOf(res)).toEqual({
      error: body.action === 'create' ? 'Failed to create AI configuration.' : 'Failed to update AI configuration.',
    });
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

  // #937: the old by-NAME saved test resolved whichever config won the
  // App → Agent → Org → Host walk, not the one being edited, and tested it on
  // the portal's own client. It's gone: a saved config tests by id (testSaved).
  it('test: a by-name "saved" test is refused, with no resolution and no LLM call', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'test', name: 'default', agentId: 'a1' } }));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockCallAgentChatLlm).not.toHaveBeenCalled();
  });

  const RESULT = {
    ok: true, provider: 'glm', model: 'glm-5.3', endpoint: 'https://api.z.ai/api/paas/v4', apiStyle: 'CHAT_COMPLETIONS',
    used: { provider: 'SAVED', model: 'SAVED', endpoint: 'SAVED', apiStyle: 'SAVED', key: 'SAVED' },
    latencyMs: 420, reply: 'I am reachable.', error: null,
  };

  it('testSaved: tests the config BY ID through the server, with no override when nothing changed', async () => {
    mockRequest.mockResolvedValueOnce({ testAiServiceConfig: RESULT });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'testSaved', id: 'cfg-org-1' } }));
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).result).toEqual(RESULT);
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'cfg-org-1', override: null });
    // The portal's own LLM client is never used for a saved config.
    expect(mockCallAgentChatLlm).not.toHaveBeenCalled();
  });

  it('testSaved: replaces an older server response that echoes a provider credential', async () => {
    mockRequest.mockResolvedValueOnce({ testAiServiceConfig: {
      ...RESULT, ok: false, reply: null,
      error: { code: 'LLM_CALL_FAILED', message: 'Authorization: Bearer sk-synthetic-966', transient: false },
    } });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'testSaved', id: 'cfg-org-1' } }));
    const body = await jsonOf(res);
    expect(body.result.error).toEqual({ code: 'LLM_CALL_FAILED', message: 'The test could not run.', transient: false });
    expect(JSON.stringify(body)).not.toContain('sk-synthetic-966');
  });

  it('testSaved: forwards only the values the user changed or typed', async () => {
    mockRequest.mockResolvedValueOnce({ testAiServiceConfig: RESULT });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'testSaved', id: 'c1', override: { model: 'glm-5.4', apiKey: 'sk-typed', provider: '' } } }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'c1', override: { model: 'glm-5.4', apiKey: 'sk-typed' } });
  });

  it('testSaved: an explicit null key (Remove the stored key) is forwarded, so the test runs keyless', async () => {
    mockRequest.mockResolvedValueOnce({ testAiServiceConfig: RESULT });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'testSaved', id: 'c1', override: { apiKey: null } } }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'c1', override: { apiKey: null } });
  });

  it('testSaved: needs an id, and RATE_LIMITED is a 429 in words', async () => {
    const { POST } = await import('./+server');
    expect((await POST(ev({ body: { action: 'testSaved' } }))).status).toBe(400);
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('x'), { response: { errors: [{ message: 'Too many', extensions: { code: 'RATE_LIMITED' } }] } }),
    );
    const res = await POST(ev({ body: { action: 'testSaved', id: 'c1' } }));
    expect(res.status).toBe(429);
    expect((await jsonOf(res)).error).toMatch(/Wait a minute/);
  });

  it('test: keeps a provider-echoed key out of the response (HTTP 200)', async () => {
    mockCallAgentChatLlm.mockRejectedValueOnce(new Error('401 Authorization: Bearer sk-synthetic-966'));
    const { POST } = await import('./+server');
    const res = await POST(
      ev({ body: { action: 'test', provider: 'anthropic', model: 'claude-x', apiKey: 'bad' } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body).toEqual({ ok: false, error: 'Chat request failed. Please try again.', code: 'failed' });
  });

  it('testSaved: keeps a provider-echoed key out of GraphQL errors', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('request failed'), {
      response: { errors: [{ message: '401 Authorization: Bearer sk-synthetic-966', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
    }));
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'testSaved', id: 'config-1' } }));
    expect(res.status).toBe(500);
    expect(await jsonOf(res)).toEqual({ error: 'The test could not run.' });
  });

  it('rejects unknown actions', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'explode' } }));
    expect(res.status).toBe(400);
  });
});
