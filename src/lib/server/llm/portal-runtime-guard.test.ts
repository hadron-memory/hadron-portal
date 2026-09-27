/**
 * Stopgap (Holger, 2026-09-27): the portal's own chat runtime calls providers
 * at fixed hosts with the config's decrypted key and ignores a config's
 * endpoint. So it runs only configs whose server-resolved effective endpoint is
 * a host it calls, and refuses the rest loudly, before the key is used. Custom
 * endpoints are called only by the server (the direction: portal chat turns
 * move there).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';
import { portalRuntimeRefusal } from './agentChatLlm';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

describe('portalRuntimeRefusal', () => {
  it('runs a built-in provider at the host this runtime calls', () => {
    expect(portalRuntimeRefusal({ provider: 'anthropic', effectiveEndpoint: 'https://api.anthropic.com/v1' })).toBeNull();
    expect(portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint: 'https://api.openai.com/v1' })).toBeNull();
    // Scheme/host case, a default port and a trailing slash are the same endpoint.
    expect(portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint: 'HTTPS://API.openai.com/v1/' })).toBeNull();
    expect(portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint: 'https://api.openai.com:443/v1' })).toBeNull();
  });

  it('the path is case-sensitive, and a query or fragment is a different endpoint (Codex on #958)', () => {
    for (const effectiveEndpoint of [
      'https://api.openai.com/V1',
      'https://api.openai.com/v1?x=1',
      'https://api.openai.com/v1#f',
      'https://api.openai.com/v1/extra',
      'https://api.openai.com:8443/v1',
    ]) {
      expect(portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint })).toMatch(/custom endpoint/);
    }
  });

  it('an endpoint that isn\'t a URL is refused without echoing it (Dara and Charles on #958)', () => {
    for (const [provider, effectiveEndpoint] of [
      ['openai', 'not-a-url?token=synthetic-secret'],
      ['anthropic', 'not a url'],
      ['bedrock', 'bedrock?key=synthetic-secret'],
      ['glm', '   '],
    ]) {
      const msg = portalRuntimeRefusal({ provider, effectiveEndpoint })!;
      expect(msg).toMatch(/endpoint isn't a valid URL/);
      expect(msg).not.toContain('synthetic-secret');
      expect(msg).not.toContain(effectiveEndpoint.trim() || '\u0000');
    }
  });

  it('GLM: the Coding Plan host it calls, and the server default kept as it was', () => {
    expect(portalRuntimeRefusal({ provider: 'glm', effectiveEndpoint: 'https://api.z.ai/api/coding/paas/v4' })).toBeNull();
    expect(portalRuntimeRefusal({ provider: 'glm', effectiveEndpoint: 'https://api.z.ai/api/paas/v4' })).toBeNull();
  });

  it('refuses a custom endpoint, naming its host and where custom endpoints run', () => {
    for (const [provider, endpoint] of [
      ['openai', 'https://proxy.example.com/v1'],
      ['anthropic', 'https://gateway.internal:8443/anthropic'],
      ['glm', 'https://open.bigmodel.cn/api/paas/v4'],
      ['openai', 'https://api.openai.com.evil.example/v1'],
    ]) {
      const msg = portalRuntimeRefusal({ provider, effectiveEndpoint: endpoint });
      expect(msg).toMatch(/custom endpoint \(/);
      expect(msg).toContain(new URL(endpoint).host);
      expect(msg).toMatch(/called only by the Hadron server/);
    }
  });

  it('refuses a provider this runtime cannot run (openai-compatible, unknown)', () => {
    for (const provider of ['openai-compatible', 'mistral', 'constructor', '__proto__']) {
      expect(portalRuntimeRefusal({ provider, effectiveEndpoint: 'https://llm.example.com/v1' })).toContain(`"${provider}" provider`);
    }
  });

  it('refuses what it cannot check: no effective endpoint for a provider that has one', () => {
    for (const effectiveEndpoint of [null, undefined]) {
      expect(portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint })).toMatch(/couldn't confirm where/);
    }
  });

  it('bedrock has no endpoint: none runs, one is refused', () => {
    expect(portalRuntimeRefusal({ provider: 'bedrock', effectiveEndpoint: null })).toBeNull();
    expect(portalRuntimeRefusal({ provider: 'bedrock', effectiveEndpoint: 'https://bedrock.example.com' })).toMatch(
      /has an endpoint \(bedrock\.example\.com\)/,
    );
  });

  it('never includes the path or query of a custom endpoint, only its host', () => {
    const msg = portalRuntimeRefusal({ provider: 'openai', effectiveEndpoint: 'https://proxy.example.com/v1?token=abc' })!;
    expect(msg).toContain('proxy.example.com');
    expect(msg).not.toContain('token=abc');
  });
});

describe('fetchAgentAIConfig refuses before handing out the key', () => {
  async function fetchConfig() {
    const { fetchAgentAIConfig } = await import('./agentChatTurn');
    return fetchAgentAIConfig('tok', 'agent-1');
  }

  it('asks the server where the config goes', () => {
    expect(RESOLVE_AI_CONFIG_QUERY).toMatch(/\beffectiveEndpoint\b/);
  });

  it('a config at its default host resolves as before', async () => {
    mockRequest.mockResolvedValue({
      resolveAIConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-canary', params: null, effectiveEndpoint: 'https://api.openai.com/v1' },
    });
    await expect(fetchConfig()).resolves.toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-canary' });
    expect(mockRequest.mock.calls[0][0]).toBe(RESOLVE_AI_CONFIG_QUERY);
  });

  it('a config with a custom endpoint throws the refusal, and the key never leaves', async () => {
    mockRequest.mockResolvedValue({
      resolveAIConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-canary', params: null, effectiveEndpoint: 'https://proxy.example.com/v1' },
    });
    const err = await fetchConfig().then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/custom endpoint \(proxy\.example\.com\)/);
    expect(err!.message).not.toContain('sk-canary');
  });

  it('openai-compatible is refused in words, not "Unsupported provider" later', async () => {
    mockRequest.mockResolvedValue({
      resolveAIConfig: { provider: 'openai-compatible', model: 'qwen3', apiKey: 'k', params: { toolCalling: true }, effectiveEndpoint: 'https://llm.example.com/v1' },
    });
    await expect(fetchConfig()).rejects.toThrow(/"openai-compatible" provider, which portal chats can't run yet/);
  });

  it('a server that predates effectiveEndpoint fails in words, never by running unchecked', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Cannot query field "effectiveEndpoint" on type "ResolvedAiConfig".'));
    await expect(fetchConfig()).rejects.toThrow(/didn't recognize effectiveEndpoint/);
  });

  it('the no-config guidance is unchanged', async () => {
    mockRequest.mockRejectedValueOnce(new Error('NoAiConfigAvailable: nothing resolves'));
    await expect(fetchConfig()).rejects.toThrow('Agent has no LLM provider configured. Set one in agent settings first.');
  });
});
