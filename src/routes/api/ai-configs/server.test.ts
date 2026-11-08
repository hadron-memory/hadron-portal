/**
 * Tests for the generic /api/ai-configs endpoint (036-ai-service-config).
 *
 * Strategy mirrors agent-chat.test.ts: mock `$lib/server/api` (the GraphQL
 * client) and `$lib/server/llm/agentChatLlm` (callAgentChatLlm), import the
 * POST handler, and invoke it with a hand-rolled RequestEvent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockGqlClient = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: mockGqlClient,
}));

const mockCallAgentChatLlm = vi.fn();
vi.mock('$lib/server/llm/agentChatLlm', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));
vi.mock('$lib/server/llm/agentChatLlm.js', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));

function ev(opts: { token?: string | null; body?: unknown; url?: string }) {
  const token = opts.token === undefined ? 'test-token' : opts.token;
  return {
    request: { json: async () => opts.body },
    locals: { token },
    url: new URL(opts.url ?? 'http://localhost/api/ai-configs'),
  } as any;
}

async function jsonOf(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

beforeEach(() => {
  mockRequest.mockReset();
  mockGqlClient.mockReset();
  mockGqlClient.mockReturnValue({ request: mockRequest });
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

  it('testSaved: forwards edited params, and a cleared (null) set, to the override (hadron-server#1413)', async () => {
    mockRequest.mockResolvedValue({ testAiServiceConfig: RESULT });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'testSaved', id: 'c1', override: { params: { toolCalling: false, maxTokens: 100 } } } }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'c1', override: { params: { toolCalling: false, maxTokens: 100 } } });
    await POST(ev({ body: { action: 'testSaved', id: 'c1', override: { params: null } } }));
    expect(mockRequest.mock.calls[1][1]).toEqual({ id: 'c1', override: { params: null } });
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

  // ── server#1373: endpoint / apiStyle, three-way ──────────────────────────
  it('create: forwards endpoint and apiStyle; an empty one is omitted (provider default)', async () => {
    mockRequest.mockResolvedValue({ createAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    const base = { action: 'create', ownerType: 'ORGANIZATION', ownerId: 'o1', name: 'default', provider: 'openai-compatible', model: 'm', apiKey: 'k' };
    await POST(ev({ body: { ...base, endpoint: 'https://llm.example.com/v1', apiStyle: 'RESPONSES' } }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ endpoint: 'https://llm.example.com/v1', apiStyle: 'RESPONSES' });
    await POST(ev({ body: { ...base, provider: 'openai', endpoint: '', apiStyle: null } }));
    expect(mockRequest.mock.calls[1][1].endpoint).toBeUndefined();
    expect(mockRequest.mock.calls[1][1].apiStyle).toBeUndefined();
  });

  it('update: an ABSENT endpoint/apiStyle is unchanged, null clears, a value sets', async () => {
    mockRequest.mockResolvedValue({ updateAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'update', id: 'c1', model: 'm' } }));
    expect('endpoint' in mockRequest.mock.calls[0][1]).toBe(false);
    expect('apiStyle' in mockRequest.mock.calls[0][1]).toBe(false);
    await POST(ev({ body: { action: 'update', id: 'c1', endpoint: null, apiStyle: null } }));
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ endpoint: null, apiStyle: null });
    await POST(ev({ body: { action: 'update', id: 'c1', endpoint: 'https://api.z.ai/api/coding/paas/v4' } }));
    expect(mockRequest.mock.calls[2][1]).toMatchObject({ endpoint: 'https://api.z.ai/api/coding/paas/v4' });
    expect('apiStyle' in mockRequest.mock.calls[2][1]).toBe(false);
  });

  it('update: ABSENT params are unchanged, null CLEARS them, a value replaces them (#951)', async () => {
    mockRequest.mockResolvedValue({ updateAiServiceConfig: { id: 'c1' } });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'update', id: 'c1', model: 'm' } }));
    expect('params' in mockRequest.mock.calls[0][1]).toBe(false);
    // The null must survive as null: omitting it would keep stale stored params.
    await POST(ev({ body: { action: 'update', id: 'c1', provider: 'glm', params: null } }));
    expect(mockRequest.mock.calls[1][1]).toHaveProperty('params', null);
    await POST(ev({ body: { action: 'update', id: 'c1', params: { temperature: 0.2 } } }));
    expect(mockRequest.mock.calls[2][1]).toHaveProperty('params', { temperature: 0.2 });
  });

  it('testSaved: an edited endpoint/apiStyle rides the override, null included', async () => {
    mockRequest.mockResolvedValueOnce({ testAiServiceConfig: RESULT });
    const { POST } = await import('./+server');
    await POST(ev({ body: { action: 'testSaved', id: 'c1', override: { endpoint: null, apiStyle: 'CHAT_COMPLETIONS' } } }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'c1', override: { endpoint: null, apiStyle: 'CHAT_COMPLETIONS' } });
  });

  it('test (inline): refused for a host the portal client would get wrong; no LLM call', async () => {
    const { POST } = await import('./+server');
    for (const body of [
      { provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1' },
      { provider: 'glm' }, // the portal's glm host is the Coding Plan, not the server default
      { provider: 'openai', endpoint: 'https://proxy.example.com/v1' },
      { provider: 'openai', apiStyle: 'CHAT_COMPLETIONS' },
    ]) {
      const res = await POST(ev({ body: { action: 'test', model: 'm', apiKey: 'k', ...body } }));
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/Save this configuration first/);
    }
    expect(mockCallAgentChatLlm).not.toHaveBeenCalled();
  });

  it('endpoints: reads the server’s suggestion list for the provider', async () => {
    const list = [{ url: 'https://api.z.ai/api/paas/v4', label: 'Z.ai (general)', isDefault: true, note: 'Pay-as-you-go' }];
    mockRequest.mockResolvedValueOnce({ aiProviderEndpoints: list });
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'endpoints', provider: 'glm' } }));
    expect((await jsonOf(res)).endpoints).toEqual(list);
    expect(mockRequest.mock.calls[0][1]).toEqual({ provider: 'glm' });
    expect((await POST(ev({ body: { action: 'endpoints' } }))).status).toBe(400);
  });

  it('endpoints: a server failure returns a fixed message, never the server’s text (#967)', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('raw'), { response: { errors: [{ message: 'Authorization: Bearer sk-leak' }] } }),
    );
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'endpoints', provider: 'glm' } }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('Could not load the known endpoints.');
  });

  it('rejects unknown actions', async () => {
    const { POST } = await import('./+server');
    const res = await POST(ev({ body: { action: 'explode' } }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ai-configs section readback', () => {
  const maskedConfig = {
    id: 'c1', name: 'default', ownerType: 'AGENT', ownerId: 'a1', provider: 'glm', model: 'glm-5',
    endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4',
    apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
    hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true,
    createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
  };

  it('requires auth and both owner arguments, with no-store on every refusal', async () => {
    const { GET } = await import('./+server');
    const unauthenticated = await GET(ev({ token: null }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store');
    const missingOwner = await GET(ev({ url: 'http://localhost/api/ai-configs?ownerType=AGENT' }));
    expect(missingOwner.status).toBe(400);
    expect(missingOwner.headers.get('cache-control')).toBe('no-store');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('reads the same masked owner list with pagination and no-store', async () => {
    mockRequest.mockResolvedValueOnce({ aiServiceConfigs: { items: [maskedConfig], total: 1 } });
    const { GET } = await import('./+server');
    const res = await GET(ev({ url: 'http://localhost/api/ai-configs?ownerType=AGENT&ownerId=a1' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf(res)).toEqual({ configs: [maskedConfig] });
    expect(mockGqlClient).toHaveBeenCalledTimes(1);
    expect(mockGqlClient).toHaveBeenCalledWith('test-token');
    expect(mockRequest.mock.calls[0][1]).toEqual({ ownerType: 'AGENT', ownerId: 'a1', limit: 200, offset: 0 });
  });

  it('reads the App chat resolution slice with the same masked fields', async () => {
    mockRequest.mockResolvedValueOnce({ resolveAiServiceConfigs: [maskedConfig] });
    const { GET } = await import('./+server');
    const res = await GET(ev({ url: 'http://localhost/api/ai-configs?appRef=app1&agentRef=agent1' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf(res)).toEqual({ configs: [maskedConfig] });
    expect(mockGqlClient).toHaveBeenCalledTimes(1);
    expect(mockGqlClient).toHaveBeenCalledWith('test-token');
    expect(mockRequest.mock.calls[0][1]).toEqual({ appRef: 'app1', agentRef: 'agent1' });
  });

  it('rejects incomplete or mixed readback arguments without querying', async () => {
    const { GET } = await import('./+server');
    const incomplete = await GET(ev({ url: 'http://localhost/api/ai-configs?appRef=app1' }));
    expect(incomplete.status).toBe(400);
    expect(incomplete.headers.get('cache-control')).toBe('no-store');
    const mixed = await GET(ev({ url: 'http://localhost/api/ai-configs?appRef=app1&agentRef=agent1&ownerType=APP&ownerId=app1' }));
    expect(mixed.status).toBe(400);
    expect(mixed.headers.get('cache-control')).toBe('no-store');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('contains a refused resolution read as failed:true', async () => {
    mockRequest.mockRejectedValueOnce(new Error('synthetic resolution failure'));
    const { GET } = await import('./+server');
    const res = await GET(ev({ url: 'http://localhost/api/ai-configs?appRef=app1&agentRef=agent1' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf(res)).toEqual({ failed: true });
  });

  it('contains a refused read in the page as failed:true', async () => {
    mockRequest.mockRejectedValueOnce(new Error('synthetic read failure'));
    const { GET } = await import('./+server');
    const res = await GET(ev({ url: 'http://localhost/api/ai-configs?ownerType=ORGANIZATION&ownerId=o1' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf(res)).toEqual({ failed: true });
  });
});
