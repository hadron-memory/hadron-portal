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
import { ORGANIZATIONS_QUERY } from '$lib/server/queries';

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

function routeMyOrgs(data: { organizations: unknown[] }) {
  mockRequest.mockImplementation(async (query: string) => {
    // hadron-server#473: wrap in the uniform { items, total } envelope.
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: data.organizations, total: data.organizations.length } };
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

  it('returns llmProviderConfigured=false when the agent has no LLM provider set', async () => {
    routeMyOrgs({ organizations: [{ ...orgA, agents: [agentUnconfigured] }] });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as {
      agent: typeof agentUnconfigured;
      llmProviderConfigured: boolean;
    };
    expect(result.llmProviderConfigured).toBe(false);
    // Loader still succeeds — page renders the read-only "configure LLM" panel
    expect(result.agent.id).toBe('agent-bbb');
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
