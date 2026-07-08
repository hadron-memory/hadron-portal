/**
 * Install-target resolution after hadron-server#551/#552 (#486): a PUBLIC
 * agent from a foreign org is installable (the marketplace path — the
 * AgentOrgGrant is auto-provisioned by createApp); a foreign NON-public
 * agent stays rejected as cross-org; unknown agents stay not-found.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATIONS_QUERY, AGENT_PUBLIC_QUERY } from '$lib/server/queries';

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
  it('admits a foreign PUBLIC agent and derives defaults from it', async () => {
    route({
      publicAgent: {
        id: 'foreign-agent',
        urn: 'other.org:concierge',
        name: 'Concierge',
        description: null,
        organizationId: 'org-OTHER',
        visibility: 'PUBLIC',
      },
    });
    const result = (await runLoad('foreign-agent')) as { org: unknown; agent: { id: string }; defaultName: string };
    expect(result.agent.id).toBe('foreign-agent');
    expect(result.defaultName).toBe('Concierge');
  });

  it('still rejects a foreign NON-public agent (visibility is the gate, not query success)', async () => {
    // agent(ref:) also succeeds for a member's own non-public agents — the
    // resolver must check visibility, not just the read succeeding.
    route({
      publicAgent: {
        id: 'foreign-agent',
        urn: 'other.org:internal',
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
});
