/**
 * Spec 019 T005 — /app/agents/[id]/test loader tests.
 *
 * Mirrors the spec-018 loader-test pattern (mock $lib/server/api,
 * import load dynamically, assert on returned data or thrown
 * SvelteKit response). The loader resolves the agent through the
 * organization-agent and ownedByMe paths, including their concealment
 * behavior for agents outside the caller's scope.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { AI_CONFIG_READINESS_QUERY, GRAPH_NODES_QUERY, MY_AGENTS_QUERY, ORGANIZATIONS_QUERY, RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(opts: { agentId?: string; token?: string | null; isConsumerMode?: boolean } = {}) {
  return {
    params: { id: opts.agentId ?? 'agent-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({ isConsumerMode: opts.isConsumerMode ?? false }),
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

function routeMyOrgs(data: { organizations: unknown[]; ownedAgents?: unknown[] }, resolution: Resolution = { ownerType: 'AGENT' }) {
  readinessCalls.length = 0;
  mockRequest.mockImplementation(async (query: string, vars: unknown) => {
    // hadron-server#473: wrap in the uniform { items, total } envelope.
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: data.organizations, total: data.organizations.length } };
    }
    if (query === MY_AGENTS_QUERY) {
      const agents = data.ownedAgents ?? [];
      return { agents: { items: agents, total: agents.length } };
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
const personalAgent = {
  ...agentConfigured,
  id: 'agent-personal',
  organizationId: null,
  name: 'My Agent',
  urn: 'hrn:agent:owner:my-agent',
  systemMemoryId: null,
  visibility: 'PUBLIC',
};

describe('/app/agents/[id]/test loader', () => {
  it('#1226: a failed fixtures read (even a later page) is fixturesError, never an empty fixture list', async () => {
    routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] });
    const base = mockRequest.getMockImplementation()!;
    const node = (i: number) => ({ node: { id: `n${i}`, loc: `fixtures:f${i}`, memoryId: 'sys-mem-a', data: null } });
    mockRequest.mockImplementation(async (query: string, vars: unknown) => {
      if (query === GRAPH_NODES_QUERY) {
        if ((vars as { offset: number }).offset > 0) throw new Error('page 2 outage');
        return { findNodes: { hits: [node(1), node(2)] } };
      }
      return base(query, vars);
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as { fixtures: unknown[]; fixturesError: boolean };
    expect(result.fixturesError).toBe(true);
    // Not the first page presented as the whole list.
    expect(result.fixtures).toEqual([]);
  });

  it('#1226: a healthy read reports no fixturesError', async () => {
    routeMyOrgs({ organizations: [{ ...orgA, agents: [agentConfigured] }] });
    const load = await importLoad();
    expect(((await load(ev({ agentId: 'agent-aaa' }))) as { fixturesError: boolean }).fixturesError).toBe(false);
  });

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
    expect(mockRequest.mock.calls.map(([query]) => query)).not.toContain(MY_AGENTS_QUERY);
  });

  it('loads a user-owned agent through the server-owned scope without an organization', async () => {
    routeMyOrgs({ organizations: [], ownedAgents: [personalAgent] });
    const load = await importLoad();
    const result = (await load(ev({ agentId: personalAgent.id, isConsumerMode: true }))) as {
      agent: typeof personalAgent;
      org: null;
      llmProviderConfigured: boolean;
    };
    expect(result.agent.id).toBe(personalAgent.id);
    expect(result.org).toBeNull();
    expect(result.llmProviderConfigured).toBe(true);
    expect(mockRequest.mock.calls.map(([query]) => query)).toContain(MY_AGENTS_QUERY);
  });

  it('keeps a user-owned agent visible when the separate AI-config gate refuses its owner', async () => {
    routeMyOrgs(
      { organizations: [], ownedAgents: [personalAgent] },
      gqlRefusal('Forbidden', 'INTERNAL_SERVER_ERROR'),
    );
    const load = await importLoad();
    const result = (await load(ev({ agentId: personalAgent.id }))) as {
      agent: typeof personalAgent;
      llm: unknown;
    };
    expect(result.agent.id).toBe(personalAgent.id);
    expect(result.llm).toEqual({ status: 'unavailable', detail: 'Forbidden' });
  });

  it('conceals an unrelated user-owned agent even when it is PUBLIC', async () => {
    routeMyOrgs({ organizations: [], ownedAgents: [personalAgent] });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'someone-elses-public-agent' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
    expect(JSON.stringify((thrown as { body: unknown }).body)).not.toContain(personalAgent.name);
    expect(mockRequest.mock.calls.map(([query]) => query)).not.toContain(AI_CONFIG_READINESS_QUERY);
  });

  it('returns the same 404 for a missing agent', async () => {
    routeMyOrgs({ organizations: [], ownedAgents: [] });
    const load = await importLoad();
    await expect(load(ev({ agentId: 'does-not-exist' }))).rejects.toMatchObject({ status: 404 });
    expect(mockRequest.mock.calls.map(([query]) => query)).not.toContain(AI_CONFIG_READINESS_QUERY);
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

  it('lets ORGANIZATIONS_QUERY errors propagate (no silent 404)', async () => {
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

  it('lets owned-agent lookup errors propagate instead of presenting a false 404', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORGANIZATIONS_QUERY) return { organizations: { items: [], total: 0 } };
      if (query === MY_AGENTS_QUERY) throw new Error('owned scope unavailable');
      throw new Error('unexpected query');
    });
    const load = await importLoad();
    await expect(load(ev({ agentId: personalAgent.id, isConsumerMode: true }))).rejects.toThrow('owned scope unavailable');
  });
});
