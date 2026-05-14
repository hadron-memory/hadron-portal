/**
 * Spec 018 — /app/agents/[id] detail-page loader tests.
 *
 * Pattern mirrors `src/routes/app/orgs/[id]/page.server.test.ts`:
 * mock `$lib/server/api`'s `gqlClient`, import `load` from
 * `+page.server.ts`, call it with a hand-rolled event. We do NOT spin
 * up SvelteKit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MY_ORGANIZATIONS_QUERY,
  ORGANIZATION_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  GRAPH_NODES_QUERY,
} from '$lib/server/queries';

// ── Mocks ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(opts: { agentId?: string; orgHint?: string | null; token?: string | null } = {}) {
  const url = new URL('http://test/app/agents/' + (opts.agentId ?? 'agent-id-123'));
  if (opts.orgHint != null) url.searchParams.set('org', opts.orgHint);
  return {
    params: { id: opts.agentId ?? 'agent-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({}),
    url,
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/**
 * Route mockRequest by query identity. Queries are imported from the real
 * `queries.ts` so the strings match exactly.
 */
function routeMock(opts: {
  myOrgs?: { data?: unknown; error?: unknown };
  org?: { data?: unknown; error?: unknown };
  orgSysMems?: { data?: unknown; error?: unknown };
  nodes?: { data?: unknown; error?: unknown };
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === MY_ORGANIZATIONS_QUERY) {
      if (opts.myOrgs?.error !== undefined) throw opts.myOrgs.error;
      return opts.myOrgs?.data ?? { myOrganizations: [] };
    }
    if (query === ORGANIZATION_QUERY) {
      if (opts.org?.error !== undefined) throw opts.org.error;
      return opts.org?.data ?? { organization: null };
    }
    if (query === ORG_SYSTEM_MEMORIES_QUERY) {
      if (opts.orgSysMems?.error !== undefined) throw opts.orgSysMems.error;
      return opts.orgSysMems?.data ?? { orgSystemMemories: [] };
    }
    if (query === GRAPH_NODES_QUERY) {
      if (opts.nodes?.error !== undefined) throw opts.nodes.error;
      return opts.nodes?.data ?? { nodes: [] };
    }
    throw new Error(`Unexpected query passed to mockRequest`);
  });
}

// Minimal fixtures. AGENT_FIELDS / ORG_FIELDS shapes are larger in
// production, but the loader only reads .id / .agents / .memoryItems /
// .systemMemoryId / .organizationId — tests pin those.
const orgA = {
  id: 'org-a', name: 'Org A', urn: 'urn:org:a',
  members: [], memories: [], agents: [], apps: [],
  subscriptions: [], exchangeConnections: [],
};
const orgB = { ...orgA, id: 'org-b', name: 'Org B', urn: 'urn:org:b' };
const agentInA = { id: 'agent-aaa', organizationId: 'org-a', name: 'Agent in A', urn: 'urn:agent:a', memoryItems: [], systemMemoryId: null };
const agentInB = { id: 'agent-bbb', organizationId: 'org-b', name: 'Agent in B', urn: 'urn:agent:b', memoryItems: [], systemMemoryId: null };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('/app/agents/[id] loader', () => {
  // ── US1: false-404 fix ───────────────────────────────────────────────────

  it('US1 — happy path, single-org user: returns agent + org from myOrganizations', async () => {
    routeMock({
      myOrgs: { data: { myOrganizations: [{ ...orgA, agents: [agentInA] }] } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      agent: typeof agentInA;
      org: typeof orgA;
      agentNodes: unknown[];
      allOrgs: unknown[];
    };
    expect(result.agent.id).toBe('agent-aaa');
    expect(result.org.id).toBe('org-a');
    expect(result.allOrgs).toHaveLength(1);
  });

  it('US1 — happy path, multi-org user: finds agent in second org', async () => {
    routeMock({
      myOrgs: {
        data: {
          myOrganizations: [
            { ...orgA, agents: [] },
            { ...orgB, agents: [agentInB] },
          ],
        },
      },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as {
      agent: typeof agentInB;
      org: typeof orgB;
    };
    expect(result.agent.id).toBe('agent-bbb');
    expect(result.org.id).toBe('org-b');
  });

  it('US1 — happy path: resolves the agent when a correct ?org=<id> hint is supplied', async () => {
    // The loader does NOT use ?org= to restrict the scan today (the
    // strict variant was reverted on 2026-05-14 because it 404'd
    // legitimate cases). The hint is metadata-only — the cross-org
    // scan finds the agent regardless. The lower test on line 226
    // covers the wrong-hint variant.
    routeMock({
      myOrgs: {
        data: {
          myOrganizations: [
            { ...orgA, agents: [agentInA] },
            { ...orgB, agents: [agentInB] },
          ],
        },
      },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb', orgHint: 'org-b' }))) as {
      agent: typeof agentInB;
      org: typeof orgB;
    };
    expect(result.agent.id).toBe('agent-bbb');
    expect(result.org.id).toBe('org-b');
  });

  it('US1 — resilience: MY_ORGANIZATIONS_QUERY errors propagate (no silent 404)', async () => {
    routeMock({ myOrgs: { error: new Error('graphql blew up') } });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-aaa' }));
    } catch (e) {
      thrown = e;
    }
    // Must NOT be a SvelteKit 404 — the previous .catch(() => []) turned
    // every transient failure into "Agent not found".
    expect(thrown).toBeDefined();
    const status = (thrown as { status?: number }).status;
    expect(status === undefined || status >= 500).toBe(true);
    expect((thrown as { body?: { message?: string } }).body?.message)
      .not.toBe('Agent not found or no longer available');
  });

  // ── US2: visibility-safety guard ─────────────────────────────────────────

  it('US2 — 404 when agent is in no user-member org', async () => {
    routeMock({
      myOrgs: { data: { myOrganizations: [{ ...orgA, agents: [agentInA] }] } },
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-unknown' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });

  it('US2 — soft-deleted agent (filtered out of myOrganizations.agents by server) returns 404', async () => {
    // The server's ORG_INCLUDE filters `deletedAt: null`, so a soft-deleted
    // agent simply doesn't appear in `o.agents`. Loader sees no match → 404.
    routeMock({
      myOrgs: { data: { myOrganizations: [{ ...orgA, agents: [] }] } },
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-aaa' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });

  it('US2 — 404 body carries no agent fields (FR-005 no-leak guard)', async () => {
    routeMock({
      myOrgs: { data: { myOrganizations: [{ ...orgA, agents: [agentInA] }] } },
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      // Ask for an id that exists nowhere
      await load(ev({ agentId: 'private-cross-org-agent' }));
    } catch (e) {
      thrown = e;
    }
    const body = (thrown as { body?: { message?: string } }).body;
    expect(body?.message).toBe('Agent not found or no longer available');
    // No agent name, URN, or description in the body
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('Agent in A');
    expect(bodyStr).not.toContain('urn:agent:a');
    expect(bodyStr).not.toContain('agent-aaa');
  });

  it('US1 — ?org=<wrong-but-member-org> still resolves the agent in its real owning org', async () => {
    // The ?org= hint is advisory — if it points at the wrong member-org,
    // the loader still scans the user's other memberships and resolves
    // the agent. Stricter behavior (refuse-on-hint-mismatch) was tried
    // and reverted on 2026-05-14 because it 404'd legitimate cases when
    // the hint was stale or missing.
    routeMock({
      myOrgs: {
        data: {
          myOrganizations: [
            { ...orgA, agents: [agentInA] },
            { ...orgB, agents: [agentInB] },
          ],
        },
      },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb', orgHint: 'org-a' }))) as {
      agent: typeof agentInB;
      org: typeof orgB;
    };
    expect(result.agent.id).toBe('agent-bbb');
    expect(result.org.id).toBe('org-b');
  });
});
