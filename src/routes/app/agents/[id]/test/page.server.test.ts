/**
 * Spec 019 T005 — /app/agents/[id]/test loader tests.
 *
 * Mirrors the spec-018 loader-test pattern (mock $lib/server/api,
 * import load dynamically, assert on returned data or thrown
 * SvelteKit response). The loader resolves the agent through the
 * same organizations[*].agents path the spec-018-fixed detail
 * loader uses, so most failure modes are inherited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { AI_CONFIG_READINESS_QUERY, ORGANIZATIONS_QUERY, RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';

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

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(opts: { agentId?: string; token?: string | null } = {}) {
  return {
    params: { id: opts.agentId ?? 'agent-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({}),
    url: new URL('http://test/app/agents/' + (opts.agentId ?? 'agent-id-123') + '/test'),
  } as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/**
 * A GraphQL error as graphql-request raises it: HTTP 200, `data: null`, and the
 * server's `errors[]`. `code` is what hadron-server's formatError puts on the
 * wire — the typed class name for NoAiConfigAvailableError, and
 * INTERNAL_SERVER_ERROR for the untyped `Error('Forbidden')`.
 */
function gqlRefusal(message: string, code: string) {
  return new ClientError(
    {
      data: null,
      errors: [{ message, path: ['resolveAIConfig'], extensions: { code } }],
      status: 200,
      headers: new Headers(),
    } as unknown as ConstructorParameters<typeof ClientError>[0],
    { query: AI_CONFIG_READINESS_QUERY, variables: {} },
  );
}

/** Where the runtime's resolution lands for this agent, or how it refuses. */
type Resolution = { ownerType: string; provider?: string; model?: string; effectiveEndpoint?: string | null } | Error;
/** The server's default endpoint per provider (hadron-server aiEndpoint.ts), as ResolvedAiConfig reports it. */
const SERVER_DEFAULT_ENDPOINT: Record<string, string | null> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  glm: 'https://api.z.ai/api/paas/v4',
  bedrock: null,
};
const inheritedFromOrg: Resolution = { ownerType: 'ORGANIZATION' };

const readinessCalls: unknown[] = [];

function routeMyOrgs(data: { organizations: unknown[] }, resolution: Resolution = { ownerType: 'AGENT' }) {
  readinessCalls.length = 0;
  mockRequest.mockImplementation(async (query: string, vars: unknown) => {
    // hadron-server#473: wrap in the uniform { items, total } envelope.
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: data.organizations, total: data.organizations.length } };
    }
    if (query === AI_CONFIG_READINESS_QUERY) {
      readinessCalls.push(vars);
      if (resolution instanceof Error) throw resolution;
      return {
        resolveAIConfig: {
          name: 'default',
          provider: resolution.provider ?? 'anthropic',
          model: resolution.model ?? 'claude-x',
          ownerType: resolution.ownerType,
          effectiveEndpoint:
            'effectiveEndpoint' in resolution
              ? resolution.effectiveEndpoint
              : (SERVER_DEFAULT_ENDPOINT[resolution.provider ?? 'anthropic'] ?? null),
        },
      };
    }
    return { findNodes: { hits: [] } };
  });
}

const orgA = {
  id: 'org-a', name: 'Org A', urn: 'urn:org:a',
  members: [], memories: [], agents: [], apps: [],
  subscriptions: [], exchangeConnections: [],
};
const agentConfigured = {
  id: 'agent-aaa',
  organizationId: 'org-a',
  name: 'Configured Agent',
  urn: 'urn:agent:a',
  systemMemoryId: 'sys-mem-a',
  memoryItems: [],
  aiProvider: 'anthropic',
  hasAiApiKey: true,
};
const agentUnconfigured = {
  ...agentConfigured,
  id: 'agent-bbb',
  name: 'Unconfigured Agent',
  urn: 'urn:agent:b',
  aiProvider: null,
  hasAiApiKey: false,
};

describe('/app/agents/[id]/test loader', () => {
  it('returns agent + org + llmProviderConfigured=true for a configured agent', async () => {
    routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      agent: typeof agentConfigured;
      org: typeof orgA;
      llmProviderConfigured: boolean;
      fixtures: unknown[];
    };
    expect(result.agent.id).toBe('agent-aaa');
    expect(result.org.id).toBe('org-a');
    expect(result.llmProviderConfigured).toBe(true);
    expect(result.fixtures).toEqual([]);
  });

  it('returns llmProviderConfigured=false when nothing resolves for the agent', async () => {
    routeMyOrgs(
      { organizations: [{ ...orgA, agents: [agentUnconfigured] }] },
      gqlRefusal("No AI config 'default' available in this context", 'NoAiConfigAvailableError'),
    );
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as {
      agent: typeof agentUnconfigured;
      llmProviderConfigured: boolean;
      llm: unknown;
    };
    expect(result.llmProviderConfigured).toBe(false);
    expect(result.llm).toEqual({
      status: 'not-configured',
      detail: "No AI config 'default' available in this context",
    });
    // Loader still succeeds — page renders the read-only "configure LLM" panel
    expect(result.agent.id).toBe('agent-bbb');
  });

  describe('#928 — readiness is the runtime resolution, not Agent.hasAiApiKey', () => {
    it('is READY for an agent with no key of its own that inherits a valid Org default', async () => {
      // hasAiApiKey is false (no Agent-owned default); the resolver walks on
      // to the Org's config, exactly as a chat turn does.
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentUnconfigured] }] }, inheritedFromOrg);
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-bbb' }))) as { llmProviderConfigured: boolean; llm: unknown };
      expect(result.llmProviderConfigured).toBe(true);
      expect(result.llm).toEqual({
        status: 'ready',
        name: 'default',
        ownerType: 'ORGANIZATION',
        provider: 'anthropic',
        model: 'claude-x',
      });
    });

    it('asks exactly what the runtime asks: the `default` config for this agent, no app', async () => {
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] });
      const load = await importLoad();
      await load(ev({ agentId: 'agent-aaa' }));
      expect(readinessCalls).toEqual([{ name: 'default', agentRef: 'agent-aaa' }]);
    });

    it('is NOT ready when the agent reports a key but nothing usable resolves (the old check said ready)', async () => {
      // The inverse of the inherited case: a stale or disabled local config.
      routeMyOrgs(
        { organizations: [{ ...orgA, agents: [agentConfigured] }] },
        gqlRefusal(
          "No AI config 'default' available in this context — config 'default' at the AGENT level has no API key stored",
          'NoAiConfigAvailableError',
        ),
      );
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-aaa' }))) as { llmProviderConfigured: boolean; llm: { status: string; detail: string } };
      expect(result.llmProviderConfigured).toBe(false);
      expect(result.llm.status).toBe('not-configured');
      expect(result.llm.detail).toContain('has no API key stored');
    });

    it('any other refusal is `unavailable` with the server\'s words — not "not configured"', async () => {
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] }, gqlRefusal('Forbidden', 'INTERNAL_SERVER_ERROR'));
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-aaa' }))) as { llmProviderConfigured: boolean; llm: unknown };
      expect(result.llmProviderConfigured).toBe(false);
      expect(result.llm).toEqual({ status: 'unavailable', detail: 'Forbidden' });
    });

    it('a transport failure is `unavailable` WITHOUT its message, which can carry the request (#468)', async () => {
      const leaky = new Error('GraphQL Error: {"query":"query AiConfigReadiness…","variables":{"agentRef":"agent-aaa"}}');
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] }, leaky);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-aaa' }))) as { llm: unknown };
      expect(result.llm).toEqual({ status: 'unavailable', detail: null });
      expect(JSON.stringify(result)).not.toContain('AiConfigReadiness');
      // …and it IS logged, being a failure to reach the server at all.
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('does not log a refusal the server gave (the non-admin case is an answer, not an outage)', async () => {
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] }, gqlRefusal('Forbidden', 'INTERNAL_SERVER_ERROR'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const load = await importLoad();
      await load(ev({ agentId: 'agent-aaa' }));
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('#958 — a config the runtime would refuse is NOT ready, in the runtime\'s own words', async () => {
      routeMyOrgs(
        { organizations: [{ ...orgA, agents: [agentConfigured] }] },
        { ownerType: 'ORGANIZATION', provider: 'openai', effectiveEndpoint: 'https://proxy.example.com/v1' },
      );
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-aaa' }))) as { llmProviderConfigured: boolean; llm: { status: string; detail: string } };
      expect(result.llmProviderConfigured).toBe(false);
      expect(result.llm.status).toBe('unavailable');
      expect(result.llm.detail).toMatch(/custom endpoint \(proxy\.example\.com\)/);
    });

    it('#958 — openai-compatible is not ready either; an openai config at its default host still is', async () => {
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] }, { ownerType: 'AGENT', provider: 'openai-compatible', effectiveEndpoint: 'https://llm.example.com/v1' });
      const load = await importLoad();
      let result = (await load(ev({ agentId: 'agent-aaa' }))) as { llm: { status: string; detail?: string } };
      expect(result.llm.status).toBe('unavailable');
      expect(result.llm.detail).toMatch(/"openai-compatible" provider/);
      routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] }, { ownerType: 'AGENT', provider: 'openai' });
      result = (await load(ev({ agentId: 'agent-aaa' }))) as { llm: { status: string } };
      expect(result.llm.status).toBe('ready');
    });

    it('#958 — a server without effectiveEndpoint is `unavailable` in words, not a raw GraphQL error', async () => {
      routeMyOrgs(
        { organizations: [{ ...orgA, agents: [agentConfigured] }] },
        gqlRefusal('Cannot query field "effectiveEndpoint" on type "ResolvedAiConfig".', 'GRAPHQL_VALIDATION_FAILED'),
      );
      const load = await importLoad();
      const result = (await load(ev({ agentId: 'agent-aaa' }))) as { llm: { status: string; detail: string } };
      expect(result.llm.status).toBe('unavailable');
      expect(result.llm.detail).toMatch(/may be older than this portal/);
    });

    it('never selects key material', () => {
      expect(AI_CONFIG_READINESS_QUERY).not.toMatch(/\bapiKey\b/);
      expect(AI_CONFIG_READINESS_QUERY).not.toMatch(/\bparams\b/);
      // The matcher can fail on a real document: the runtime's own query,
      // which does need the key, trips it.
      expect(RESOLVE_AI_CONFIG_QUERY).toMatch(/\bapiKey\b/);
    });
  });

  it('404s when the agent is not in any of the user member orgs (FR-005 no-leak)', async () => {
    routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-not-here' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
    // Body must NOT leak agent-aaa's fields
    const body = JSON.stringify((thrown as { body: unknown }).body);
    expect(body).not.toContain('Configured Agent');
    expect(body).not.toContain('urn:agent:a');
  });

  it('lets MY_ORGANIZATIONS_QUERY errors propagate (no silent 404)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('graphql blew up'));
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-aaa' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const status = (thrown as { status?: number }).status;
    // Must not be a SvelteKit 404 — same lesson as spec 018.
    expect(status === undefined || status >= 500).toBe(true);
  });
});
