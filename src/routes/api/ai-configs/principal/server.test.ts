/**
 * Tests for GET /api/ai-configs/principal (#1955, split from the owner-list route in #1986).
 *
 * Strategy mirrors agent-chat.test.ts: mock `$lib/server/api` (the GraphQL
 * client) and `$lib/server/llm/agentChatLlm` (callAgentChatLlm), import the
 * POST handler, and invoke it with a hand-rolled RequestEvent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockGqlClient = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: mockGqlClient,
}));

const mockCallAgentChatLlm = vi.fn();
vi.mock('$lib/server/llm/agentChatLlm', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));
vi.mock('$lib/server/llm/agentChatLlm.js', () => ({ callAgentChatLlm: mockCallAgentChatLlm }));

function ev(opts: { token?: string | null; body?: unknown; url?: string; signal?: AbortSignal }) {
  const token = opts.token === undefined ? 'test-token' : opts.token;
  return {
    request: { json: async () => opts.body, signal: opts.signal ?? new AbortController().signal },
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
});

describe('#1955/#1986 current-cookie principal read (dedicated route)', () => {
  it('returns no principal without a cookie and never queries or mutates', async () => {
    const { GET } = await import('./+server');
    const response = await GET(ev({ token: null, url: 'http://localhost/api/ai-configs/principal' }));
    expect(await jsonOf(response)).toEqual({ principal: null });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([null, { principalType: 'USER', user: { id: 'fresh-user' }, appId: null }, { principalType: 'APP', user: null, appId: 'fresh-app' }])('reads existing authContext using this request token: %j', async context => {
    mockRequest.mockResolvedValueOnce({ authContext: context });
    const { GET } = await import('./+server');
    const response = await GET(ev({ token: 'fresh-cookie-token', url: 'http://localhost/api/ai-configs/principal' }));
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ principal: context === null ? null : {
      principalType: context.principalType, userId: context.user?.id ?? null, appId: context.appId,
    } });
    expect(mockGqlClient.mock.calls[0][0]).toBe('fresh-cookie-token');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toMatch(/query AiConfigPrincipal.*authContext.*principalType.*user.*id.*appId/s);
    expect(mockRequest.mock.calls[0][0]).not.toMatch(/mutation|apiKey|hasApiKey|aiServiceConfigs|resolveAIConfig/i);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns fixed-copy unavailable on an identity outage, never upstream text or a write', async () => {
    mockRequest.mockRejectedValueOnce(new Error('sensitive-upstream'));
    const { GET } = await import('./+server');
    const response = await GET(ev({ url: 'http://localhost/api/ai-configs/principal' }));
    expect(response.status).toBe(503);
    expect(await jsonOf(response)).toEqual({ error: 'Unable to verify your sign-in. Try again.' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  // hrn:node:hadronmemory.com:specs:cor:dmo:050:10: the key stays masked everywhere but its one gated decrypt
  // path. The split route returns identity only, whatever the upstream says.
  it('returns only the three identity fields even if the upstream answer carries more', async () => {
    mockRequest.mockResolvedValueOnce({ authContext: { principalType: 'USER', user: { id: 'u1', email: 'x@y.z' }, appId: null, apiKey: 'synthetic-secret', configs: [{ apiKeyPreview: '…test' }] } });
    const { GET } = await import('./+server');
    const response = await GET(ev({ token: 'cookie' }));
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ principal: { principalType: 'USER', userId: 'u1', appId: null } });
    expect(text).not.toMatch(/synthetic-secret|apiKey|configs|email/);
  });
});
