/**
 * Install-target resolution after hadron-server#551/#552 (#486): a PUBLIC
 * agent from a foreign org is installable (the marketplace path — the
 * AgentOrgGrant is auto-provisioned by createApp); a foreign NON-public
 * agent stays rejected as cross-org; unknown agents stay not-found.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import { ORGANIZATIONS_QUERY, AGENT_PUBLIC_QUERY, ORG_APPS_FOR_REGISTER_QUERY } from '$lib/server/queries';

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

const memberOrg = {
  id: 'org-1',
  urn: 'my.org',
  name: 'My Org',
  members: [],
  agents: [{ id: 'own-agent', urn: 'my.org:helper', name: 'Helper', memoryItems: [] }],
  apps: [],
};

function route(opts: { publicAgent?: unknown }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: [memberOrg], total: 1 } };
    }
    if (query === ORG_APPS_FOR_REGISTER_QUERY) return { apps: { items: [], total: 0 } };
    if (query === AGENT_PUBLIC_QUERY) return { agent: opts.publicAgent ?? null };
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

async function runLoad(aid: string) {
  const { load } = await import('./+page.server');
  return load({
    params: { id: 'org-1', aid },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false }),
  } as never);
}

describe('install target resolution — PUBLIC marketplace path (#486)', () => {
  it('admits a foreign PUBLIC agent and derives defaults from its CANONICAL urn', async () => {
    route({
      publicAgent: {
        id: 'foreign-agent',
        // Canonical shape — a first-colon slug slice returned
        // "agent:other.org::concierge" here (PR-499 review).
        urn: 'hrn:agent:other.org::concierge',
        name: 'Concierge',
        description: null,
        organizationId: 'org-OTHER',
        visibility: 'PUBLIC',
      },
    });
    const result = (await runLoad('foreign-agent')) as {
      org: unknown;
      agent: { id: string };
      defaultName: string;
      defaultUrnSlug: string;
    };
    expectDistinctFormIds(result, 2);
    expect(result.agent.id).toBe('foreign-agent');
    expect(result.defaultName).toBe('Concierge');
    expect(result.defaultUrnSlug).toBe('concierge');
  });

  it('still rejects a foreign NON-public agent (visibility is the gate, not query success)', async () => {
    // agent(ref:) also succeeds for a member's own non-public agents — the
    // resolver must check visibility, not just the read succeeding.
    route({
      publicAgent: {
        id: 'foreign-agent',
        urn: 'hrn:agent:other.org::internal',
        name: 'Internal',
        description: null,
        organizationId: 'org-OTHER',
        visibility: 'ORGANIZATION',
      },
    });
    await expect(runLoad('foreign-agent')).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the own-org path working without touching the public read', async () => {
    route({});
    const result = (await runLoad('own-agent')) as { agent: { id: string } };
    expect(result.agent.id).toBe('own-agent');
    expect(mockRequest.mock.calls.some(([q]) => q === AGENT_PUBLIC_QUERY)).toBe(false);
  });

  it('unknown agent stays not-found', async () => {
    route({});
    await expect(runLoad('ghost')).rejects.toMatchObject({ status: 404 });
  });
  it('conceals a typed FORBIDDEN agent read as not found in both GET and existing new-App POST', async () => {
    route({});
    const prior = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (query: string, ...args: unknown[]) => {
      if (query === AGENT_PUBLIC_QUERY) throw { response: { errors: [{ extensions: { code: 'FORBIDDEN' } }] } };
      return prior(query, ...args);
    });
    await expect(runLoad('foreign-private')).rejects.toMatchObject({ status: 404 });
    const { actions } = await import('./+page.server');
    const fd = new FormData();
    for (const [k, v] of Object.entries({ _kind: 'installAgent', name: 'Helper', urn: 'helper', appType: 'WORKSTATION' })) fd.set(k, v);
    const result = await actions.install!({ params: { id: 'org-1', aid: 'foreign-private' }, locals: { token: 'tok' }, request: { formData: async () => fd } } as never);
    expect(result).toMatchObject({ status: 404 });
    expect(mockRequest.mock.calls.some(([doc]) => /mutation/.test(doc))).toBe(false);
  });

  it('propagates transport failure on an agent lookup instead of pretending it is absent', async () => {
    route({});
    const prior = mockRequest.getMockImplementation()!;
    const outage = new TypeError('fetch failed');
    mockRequest.mockImplementation(async (query: string, ...args: unknown[]) => {
      if (query === AGENT_PUBLIC_QUERY) throw outage;
      return prior(query, ...args);
    });
    await expect(runLoad('foreign-agent')).rejects.toBe(outage);
  });

});
