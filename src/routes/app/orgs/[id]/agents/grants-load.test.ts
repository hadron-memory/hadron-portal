/**
 * Subscribed-agents tab loader (#486): the org's AgentOrgGrants filtered to
 * agents OWNED BY OTHER ORGS (own-agent grants are auto-provisioned by every
 * install — noise here), with transport failures coerced to null (an
 * "unavailable" state) rather than a false "no subscriptions".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORGANIZATION_QUERY,
  ORG_APP_INSTALLS_QUERY,
  ORG_AGENT_GRANTS_QUERY,
} from '$lib/server/queries';

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

const ORG_ID = 'org-1';

const grant = (agentId: string, orgId: string, over: Record<string, unknown> = {}) => ({
  agentId,
  activatedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  isActive: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  agent: {
    id: agentId,
    urn: `hrn:agent:other.org::${agentId}`,
    name: agentId,
    description: null,
    organizationId: orgId,
  },
  ...over,
});

function route(opts: { grants?: unknown[]; grantsError?: boolean }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATION_QUERY) {
      return { organization: { id: ORG_ID, name: 'Org', agents: [] } };
    }
    if (query === ORG_APP_INSTALLS_QUERY) return { apps: { items: [], total: 0 } };
    if (query === ORG_AGENT_GRANTS_QUERY) {
      if (opts.grantsError) throw new Error('boom');
      return { organization: { agentOrgGrants: opts.grants ?? [] } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

async function runLoad() {
  const { load } = await import('./+page.server');
  return (await load({
    params: { id: ORG_ID },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false }),
  } as never)) as { subscribedGrants: unknown[] | null };
}

describe('org agents loader — subscribed grants (#486)', () => {
  it('keeps only grants for agents owned by OTHER orgs', async () => {
    route({
      grants: [
        grant('foreign-agent', 'org-OTHER'),
        grant('own-agent', ORG_ID),
        grant('dangling', 'org-OTHER', { agent: null }),
      ],
    });
    const result = await runLoad();
    expect(result.subscribedGrants).toHaveLength(1);
    expect(result.subscribedGrants![0]).toMatchObject({ agentId: 'foreign-agent' });
  });

  it('returns [] (a real empty state) when the org has no cross-org grants', async () => {
    route({ grants: [grant('own-agent', ORG_ID)] });
    expect((await runLoad()).subscribedGrants).toEqual([]);
  });

  it('coerces a grants fetch failure to null — unavailable, not empty', async () => {
    route({ grantsError: true });
    expect((await runLoad()).subscribedGrants).toBeNull();
  });
});
