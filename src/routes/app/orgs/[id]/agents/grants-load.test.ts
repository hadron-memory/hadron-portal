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
  PUBLIC_AGENTS_QUERY,
  CREATE_AGENT_ORG_GRANT_MUTATION,
  REVOKE_AGENT_ORG_GRANT_MUTATION,
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

function route(opts: { grants?: unknown[]; grantsError?: boolean; publicAgents?: unknown[] }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATION_QUERY) {
      return { organization: { id: ORG_ID, name: 'Org', agents: [] } };
    }
    if (query === ORG_APP_INSTALLS_QUERY) return { apps: { items: [], total: 0 } };
    if (query === ORG_AGENT_GRANTS_QUERY) {
      if (opts.grantsError) throw new Error('boom');
      return { organization: { agentOrgGrants: opts.grants ?? [] } };
    }
    if (query === PUBLIC_AGENTS_QUERY) {
      const items = opts.publicAgents ?? [];
      return { publicAgents: { items, total: items.length } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

/** The org the LAYOUT supplies. #382: the loader reads it from here. */
const PARENT_ORG = { id: ORG_ID, name: 'Org from layout', agents: [] };

async function runLoad() {
  const { load } = await import('./+page.server');
  return (await load({
    params: { id: ORG_ID },
    locals: { token: 'tok' },
    // #382: the org now arrives from the LAYOUT rather than from a second
    // ORGANIZATION_QUERY in this loader.
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false, org: PARENT_ORG }),
  } as never)) as {
    org: unknown;
    subscribedGrants: unknown[] | null;
    subscribablePublicAgents: Array<{ id: string }>;
    subscribeForm: { data: { agentId: string } };
    unsubscribeForm: { data: { agentId: string } };
  };
}

async function runSubscribe(agentId = 'foreign-agent') {
  const fd = new FormData();
  if (agentId) fd.set('agentId', agentId);
  const { actions } = await import('./+page.server');
  return actions.subscribe!({
    params: { id: ORG_ID },
    locals: { token: 'tok' },
    request: { formData: async () => fd },
  } as never);
}

async function runUnsubscribe(agentId = 'foreign-agent') {
  const fd = new FormData();
  if (agentId) fd.set('agentId', agentId);
  const { actions } = await import('./+page.server');
  return actions.unsubscribe!({
    params: { id: ORG_ID },
    locals: { token: 'tok' },
    request: { formData: async () => fd },
  } as never);
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

  it('picker candidates exclude own-org agents and already-granted agents (#486)', async () => {
    const pub = (id: string, orgId: string) => ({
      id, urn: `hrn:agent:other.org::${id}`, name: id, description: null,
      organizationId: orgId, visibility: 'PUBLIC',
    });
    route({
      grants: [grant('already-granted', 'org-OTHER')],
      publicAgents: [pub('fresh', 'org-OTHER'), pub('already-granted', 'org-OTHER'), pub('own-public', ORG_ID)],
    });
    const result = await runLoad();
    expect(result.subscribablePublicAgents.map((a) => a.id)).toEqual(['fresh']);
  });

  it('seeds the subscribe form with an explicit empty choice', async () => {
    route({});
    const result = await runLoad();
    expect(result.subscribeForm.data.agentId).toBe('');
    expect(result.unsubscribeForm.data.agentId).toBe('');
  });
});

describe('org agents subscribe action (#649)', () => {
  it('creates an AgentOrgGrant without routing through createApp', async () => {
    mockRequest.mockResolvedValueOnce({
      createAgentOrgGrant: { orgId: ORG_ID, agentId: 'foreign-agent', isActive: true },
    });

    await expect(runSubscribe()).resolves.toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'subscribeAgent', agentId: 'foreign-agent' },
        message: { type: 'success', text: 'Subscribed to agent.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockRequest).toHaveBeenCalledWith(CREATE_AGENT_ORG_GRANT_MUTATION, {
      agentRef: 'foreign-agent',
      orgRef: ORG_ID,
    });
  });

  it('rejects an empty selection without calling GraphQL', async () => {
    await expect(runSubscribe('')).resolves.toMatchObject({
      status: 400,
      data: { form: { errors: { agentId: expect.any(Array) } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects subscribe POSTs with the wrong form discriminator', async () => {
    const fd = new FormData();
    fd.set('_kind', 'unsubscribe');
    fd.set('agentId', 'foreign-agent');
    const { actions } = await import('./+page.server');

    await expect(actions.subscribe!({
      params: { id: ORG_ID },
      locals: { token: 'tok' },
      request: { formData: async () => fd },
    } as never)).resolves.toMatchObject({
      status: 400,
      data: { form: { errors: { _kind: expect.any(Array) } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns the server GraphQL message when subscription fails', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Only PUBLIC agents can be subscribed to.' }] },
    });

    await expect(runSubscribe()).resolves.toMatchObject({
      status: 500,
      data: {
        form: {
          message: { type: 'error', text: 'Only PUBLIC agents can be subscribed to.' },
        },
      },
    });
  });
});

describe('org agents unsubscribe action (#651)', () => {
  it('revokes the AgentOrgGrant without deleting App state', async () => {
    mockRequest.mockResolvedValueOnce({
      revokeAgentOrgGrant: { agentId: 'foreign-agent' },
    });

    await expect(runUnsubscribe()).resolves.toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'unsubscribeAgent', agentId: 'foreign-agent' },
        message: { type: 'success', text: 'Unsubscribed from agent.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockRequest).toHaveBeenCalledWith(REVOKE_AGENT_ORG_GRANT_MUTATION, {
      agentRef: 'foreign-agent',
      orgRef: ORG_ID,
    });
  });

  it('rejects an empty selection without calling GraphQL', async () => {
    await expect(runUnsubscribe('')).resolves.toMatchObject({
      status: 400,
      data: { form: { errors: { agentId: expect.any(Array) } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unsubscribe POSTs with the wrong form discriminator', async () => {
    const fd = new FormData();
    fd.set('_kind', 'subscribeAgent');
    fd.set('agentId', 'foreign-agent');
    const { actions } = await import('./+page.server');

    await expect(actions.unsubscribe!({
      params: { id: ORG_ID },
      locals: { token: 'tok' },
      request: { formData: async () => fd },
    } as never)).resolves.toMatchObject({
      status: 400,
      data: { form: { errors: { _kind: expect.any(Array) } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns the server GraphQL message when revocation fails', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'AgentOrgGrant not found.' }] },
    });

    await expect(runUnsubscribe()).resolves.toMatchObject({
      status: 500,
      data: { form: { message: { type: 'error', text: 'AgentOrgGrant not found.' } } },
    });
  });
});

/**
 * #382 — the loader must NOT re-fetch the organization.
 *
 * The org layout already runs ORGANIZATION_QUERY for this same `params.id` on
 * this same request; this loader used to run it again.
 *
 * Both directions are pinned, because an ABSENCE assertion is the one most
 * likely to pass for the wrong reason: a loader that fetched nothing and
 * returned nothing would satisfy "no ORGANIZATION_QUERY" on its own.
 */
describe('org agents load() — the org comes from THIS LOADER (#382 → #845)', () => {
  // Inverted deliberately by #845. The layout now fetches chrome only, because
  // Organization's nested fields are non-null while `organization(ref:)` is
  // nullable — so one list failing nulled the org and 404'd every tab. The
  // Agents tab renders `org.agents`, so it fetches the org itself now.
  it('issues its own ORGANIZATION_QUERY rather than taking the org from parent()', async () => {
    route({});
    const result = await runLoad();

    // Not PARENT_ORG: the fetched one wins, and `name` is what tells them apart.
    expect(result.org).not.toBe(PARENT_ORG);
    expect((result.org as { name: string }).name).toBe('Org');
    expect(mockRequest.mock.calls.filter(([q]) => q === ORGANIZATION_QUERY)).toHaveLength(1);
    // Still asks for what it also needs, so "queried nothing" cannot pass.
    expect(mockRequest.mock.calls.filter(([q]) => q === PUBLIC_AGENTS_QUERY)).toHaveLength(1);
  });
});
