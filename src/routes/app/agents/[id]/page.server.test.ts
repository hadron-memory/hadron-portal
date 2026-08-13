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
  AGENT_QUERY,
  ORGANIZATIONS_QUERY,
  ORGANIZATION_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  PERSONAL_MEMORIES_LITE_QUERY,
  GRAPH_NODES_QUERY,
  AGENT_APPS_QUERY,
  AGENT_OWNED_APPS_QUERY,
  DELETE_AGENT_MUTATION,
  REMOVE_MEMORY_FROM_AGENT_MUTATION,
  UPDATE_AGENT_MEMORY_ROLE_MUTATION,
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

async function importMod() {
  return import('./+page.server');
}

function ev(opts: { agentId?: string; token?: string | null } = {}) {
  const url = new URL('http://test/app/agents/' + (opts.agentId ?? 'agent-id-123'));
  return {
    params: { id: opts.agentId ?? 'agent-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({}),
    url,
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

function actionEv(fields: Record<string, string>, opts: { agentId?: string; token?: string | null } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: opts.agentId ?? 'agent-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['updateMemoryRole']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runUpdateMemoryRole(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.updateMemoryRole(actionEv(fields));
}

async function runRemoveMemory(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.removeMemory(actionEv(fields));
}

async function runDeleteAgent(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.delete(actionEv(fields));
}

/**
 * Route mockRequest by query identity. Queries are imported from the real
 * `queries.ts` so the strings match exactly.
 */
function routeMock(opts: {
  agent?: { data?: unknown; error?: unknown };
  myOrgs?: { data?: unknown; error?: unknown };
  org?: { data?: unknown; error?: unknown };
  orgSysMems?: { data?: unknown; error?: unknown };
  personalMems?: { data?: unknown[]; error?: unknown };
  nodes?: { data?: unknown; error?: unknown };
  apps?: { data?: unknown; error?: unknown };
  ownedApps?: { data?: unknown; error?: unknown };
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === AGENT_QUERY) {
      if (opts.agent?.error !== undefined) throw opts.agent.error;
      return opts.agent?.data ?? { agent: null };
    }
    if (query === ORGANIZATIONS_QUERY) {
      if (opts.myOrgs?.error !== undefined) throw opts.myOrgs.error;
      // hadron-server#473: wrap in the uniform { items, total } envelope.
      const orgs =
        (opts.myOrgs?.data as { organizations: unknown[] } | undefined)?.organizations ?? [];
      return { organizations: { items: orgs, total: orgs.length } };
    }
    if (query === ORGANIZATION_QUERY) {
      if (opts.org?.error !== undefined) throw opts.org.error;
      return opts.org?.data ?? { organization: null };
    }
    if (query === ORG_SYSTEM_MEMORIES_QUERY) {
      if (opts.orgSysMems?.error !== undefined) throw opts.orgSysMems.error;
      return opts.orgSysMems?.data ?? { memories: { items: [], total: 0 } };
    }
    if (query === PERSONAL_MEMORIES_LITE_QUERY) {
      if (opts.personalMems?.error !== undefined) throw opts.personalMems.error;
      const items = opts.personalMems?.data ?? [];
      return { memories: { items, total: items.length } };
    }
    if (query === GRAPH_NODES_QUERY) {
      if (opts.nodes?.error !== undefined) throw opts.nodes.error;
      return opts.nodes?.data ?? { findNodes: { hits: [] } };
    }
    if (query === AGENT_APPS_QUERY) {
      const apps = (opts.apps?.data as unknown[]) ?? [];
      return { apps: { items: apps, total: apps.length } };
    }
    // The org-less companion (filter.ownedByMe) is a SEPARATE document — the
    // loader catches its failure, so an unmocked one would degrade silently
    // instead of failing the test.
    if (query === AGENT_OWNED_APPS_QUERY) {
      const apps = (opts.ownedApps?.data as unknown[]) ?? [];
      return { apps: { items: apps, total: apps.length } };
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
// #636: a user-owned (org-less) agent — organizationId null, reachable via agent(ref:).
// #642: non-PUBLIC ⇒ agent(ref:) only returned it to its owner, so the caller owns it.
const personalAgent = { id: 'agent-personal', organizationId: null, visibility: 'PERSONAL', name: 'My Agent', urn: 'urn:agent:ada::my-agent', memoryItems: [], systemMemoryId: null };
// A PUBLIC org-less agent — reachable by any caller (not necessarily the owner),
// and owner-only memories can't be attached to it (congruence).
const publicPersonalAgent = { ...personalAgent, id: 'agent-public', visibility: 'PUBLIC' };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('/app/agents/[id] loader', () => {
  // ── Org agents: resolved via agent(ref:), org chrome loaded ──────────────

  it('org agent: returns the agent + its org (agent(ref:) then organizations())', async () => {
    routeMock({
      agent: { data: { agent: agentInA } },
      myOrgs: { data: { organizations: [orgA] } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      agent: typeof agentInA;
      org: typeof orgA;
      allOrgs: unknown[];
    };
    expect(result.agent.id).toBe('agent-aaa');
    expect(result.org?.id).toBe('org-a');
    expect(result.allOrgs).toHaveLength(1);
  });

  it('org agent in a non-first member org is still resolved', async () => {
    routeMock({
      agent: { data: { agent: agentInB } },
      myOrgs: { data: { organizations: [orgA, orgB] } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as { org: typeof orgB };
    expect(result.org?.id).toBe('org-b');
  });

  // ── #636: user-owned (org-less) agent is reachable, org is null ──────────

  it('user-owned agent: reachable with org null, no organizations() fetch', async () => {
    routeMock({ agent: { data: { agent: personalAgent } } });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as {
      agent: typeof personalAgent;
      org: unknown;
      allOrgs: unknown[];
    };
    expect(result.agent.id).toBe('agent-personal');
    expect(result.org).toBeNull();
    expect(result.allOrgs).toEqual([]);
    // ORGANIZATIONS_QUERY must NOT be called for an org-less agent.
    expect(mockRequest).not.toHaveBeenCalledWith(ORGANIZATIONS_QUERY, expect.anything());
  });

  // ── #642: personal memories in the "Add memory" picker ───────────────────

  it("owned, non-PUBLIC agent: offers the caller's own personal memories to attach (#642)", async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      personalMems: { data: [{ id: 'pm1', name: 'my notes', urn: 'hrn:mem:ada:notes', class: 'personal', organizationId: null }] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as { personalMemories: Array<{ id: string }> };
    expect(result.personalMemories).toEqual([
      { id: 'pm1', name: 'my notes', urn: 'hrn:mem:ada:notes', class: 'personal', organizationId: null },
    ]);
  });

  it('org agent: does NOT fetch personal memories (no leak into an org-visible agent)', async () => {
    routeMock({
      agent: { data: { agent: agentInA } },
      myOrgs: { data: { organizations: [orgA] } },
      personalMems: { data: [{ id: 'pm1', name: 'my notes', urn: 'u', class: 'personal', organizationId: null }] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as { personalMemories: unknown[] };
    expect(result.personalMemories).toEqual([]);
    // The personal-memories query must never run for an org agent.
    expect(mockRequest).not.toHaveBeenCalledWith(PERSONAL_MEMORIES_LITE_QUERY, expect.anything());
  });

  it('PUBLIC org-less agent: does NOT fetch personal memories (not necessarily owned; congruence forbids attaching owner-only memories)', async () => {
    routeMock({
      agent: { data: { agent: publicPersonalAgent } },
      personalMems: { data: [{ id: 'pm1', name: 'my notes', urn: 'u', class: 'personal', organizationId: null }] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-public' }))) as { personalMemories: unknown[] };
    expect(result.personalMemories).toEqual([]);
    expect(mockRequest).not.toHaveBeenCalledWith(PERSONAL_MEMORIES_LITE_QUERY, expect.anything());
  });

  // ── Resilience + not-found ───────────────────────────────────────────────

  it('resilience: a thrown agent(ref:) error propagates (not a silent 404)', async () => {
    routeMock({ agent: { error: new Error('graphql blew up') } });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-aaa' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const status = (thrown as { status?: number }).status;
    expect(status === undefined || status >= 500).toBe(true);
    expect((thrown as { body?: { message?: string } }).body?.message)
      .not.toBe('Agent not found or no longer available');
  });

  it('404 when agent(ref:) resolves to null (not found / no access / soft-deleted)', async () => {
    routeMock({ agent: { data: { agent: null } } });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-unknown' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });

  it('404 body carries no agent fields (no-leak guard)', async () => {
    routeMock({ agent: { data: { agent: null } } });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'private-cross-org-agent' }));
    } catch (e) {
      thrown = e;
    }
    const body = (thrown as { body?: { message?: string } }).body;
    expect(body?.message).toBe('Agent not found or no longer available');
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('Agent in A');
    expect(bodyStr).not.toContain('urn:agent:a');
  });

  it('404 when an org agent’s org is not among the caller’s memberships', async () => {
    // agent(ref:) returned an org agent, but organizations() (the membership
    // list) doesn't contain its org — treat as not-available.
    routeMock({
      agent: { data: { agent: agentInB } },
      myOrgs: { data: { organizations: [orgA] } },
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ agentId: 'agent-bbb' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });
});

describe('/app/agents/[id] memory actions', () => {
  it('updates an attached memory role with trimmed Superforms data', async () => {
    mockRequest.mockResolvedValueOnce({ updateAgentMemoryRole: true });

    const result = await runUpdateMemoryRole({ memoryId: ' memory-1 ', role: 'read-write' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Memory role updated.' });
    expect(mockRequest).toHaveBeenCalledWith(UPDATE_AGENT_MEMORY_ROLE_MUTATION, {
      agentRef: 'agent-id-123',
      memoryRef: 'memory-1',
      role: 'read-write',
    });
  });

  it('rejects memory role updates with the wrong action discriminator', async () => {
    const result = await runUpdateMemoryRole({ _kind: 'removeMemory', memoryId: 'memory-1', role: 'read' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects memory role updates with an omitted memory before calling the API', async () => {
    const result = await runUpdateMemoryRole({ role: 'read' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'memoryId')).toBe('Select a memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns memory role update GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('role update failed'));

    const result = await runUpdateMemoryRole({ memoryId: 'memory-1', role: 'read' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'role update failed' });
  });

  it('removes an attached memory with typed Superforms feedback', async () => {
    mockRequest.mockResolvedValueOnce({ removeMemoryFromAgent: true });

    const result = await runRemoveMemory({ memoryId: ' memory-1 ' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Memory removed.' });
    expect(mockRequest).toHaveBeenCalledWith(REMOVE_MEMORY_FROM_AGENT_MUTATION, {
      agentRef: 'agent-id-123',
      memoryRef: 'memory-1',
    });
  });

  it('rejects remove-memory payloads with the wrong action discriminator', async () => {
    const result = await runRemoveMemory({ _kind: 'updateMemoryRole', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects remove-memory payloads with an omitted memory before calling the API', async () => {
    const result = await runRemoveMemory({});

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'memoryId')).toBe('Select a memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns remove-memory GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('remove failed'));

    const result = await runRemoveMemory({ memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'remove failed' });
  });
});

describe('/app/agents/[id] delete action', () => {
  // #647: the post-delete redirect depends on ownership — the action resolves the
  // agent's org (first request) before deleting (second request).
  it('deletes a personal (org-less) agent and redirects to the personal My agents list', async () => {
    mockRequest
      .mockResolvedValueOnce({ agent: { organizationId: null } }) // org lookup
      .mockResolvedValueOnce({ deleteAgent: true }); // delete

    let thrown: unknown;
    try {
      await runDeleteAgent({});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/agents');
    expect(mockRequest).toHaveBeenCalledWith(DELETE_AGENT_MUTATION, { ref: 'agent-id-123' });
  });

  it('deletes an org agent and redirects to that org’s agents grid', async () => {
    mockRequest
      .mockResolvedValueOnce({ agent: { organizationId: 'org-9' } }) // org lookup
      .mockResolvedValueOnce({ deleteAgent: true }); // delete

    let thrown: unknown;
    try {
      await runDeleteAgent({});
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-9/agents');
  });

  it('falls back to the personal list when the org lookup fails', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('lookup failed')) // org lookup (non-fatal)
      .mockResolvedValueOnce({ deleteAgent: true }); // delete still runs

    let thrown: unknown;
    try {
      await runDeleteAgent({});
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/agents');
  });

  it('rejects delete-agent payloads with the wrong action discriminator', async () => {
    const result = await runDeleteAgent({ _kind: 'removeMemory' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns delete-agent GraphQL failures as Superforms messages', async () => {
    mockRequest
      .mockResolvedValueOnce({ agent: { organizationId: null } }) // org lookup ok
      .mockRejectedValueOnce(new Error('delete failed')); // delete fails

    const result = await runDeleteAgent({});

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'delete failed' });
  });
});

// ── #713: Bundled agents ────────────────────────────────────────────────────
//
// "Bundled" has TWO sources, and the one that matters in practice is the
// non-obvious one: createTeamPersona installs each minted persona into the
// team App and writes NO AgentImport edge, so a Team Agent's personas are its
// co-installed SIBLINGS. AgentImport edges are folded in on top.

describe('/app/agents/[id] loader — bundled agents (#713)', () => {
  const iris = {
    id: 'agent-iris', name: 'Iris', urn: 'hrn:agent:acme.com:iris',
    description: 'AI coding agent', personaName: 'Iris', personaRole: 'backend-engineer',
  };
  const rufus = {
    id: 'agent-rufus', name: 'Rufus', urn: 'hrn:agent:acme.com:rufus',
    description: null, personaName: 'Rufus', personaRole: 'frontend-engineer',
  };
  const selfLite = {
    id: 'agent-aaa', name: 'Agent in A', urn: 'urn:agent:a',
    description: null, personaName: null, personaRole: null,
  };

  async function loadBundled(opts: { agent?: unknown; apps?: unknown[]; ownedApps?: unknown[] }) {
    routeMock({
      agent: { data: { agent: opts.agent ?? agentInA } },
      myOrgs: { data: { organizations: [orgA] } },
      apps: { data: opts.apps ?? [] },
      ownedApps: { data: opts.ownedApps ?? [] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      bundledAgents: Array<{
        id: string; name: string; via: string;
        personaRole: string | null; description: string | null;
      }>;
      installedApps: Array<{ id: string }>;
    };
    return result;
  }

  it('lists the co-installed siblings, excluding the agent itself', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      apps: [{
        id: 'app-1', name: 'Team App', urn: 'urn:app:1', organizationId: 'org-a',
        agentId: 'agent-aaa', agents: [selfLite, iris, rufus],
      }],
    });
    expect(bundled.map((a) => a.id)).toEqual(['agent-iris', 'agent-rufus']);
    expect(bundled[0]).toMatchObject({ name: 'Iris', personaRole: 'backend-engineer', via: 'Team App' });
  });

  it('ignores apps this agent is not installed in', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      apps: [{
        id: 'app-2', name: 'Someone Else', urn: 'urn:app:2', organizationId: 'org-a',
        agentId: 'agent-zzz', agents: [{ ...iris, id: 'agent-other' }],
      }],
    });
    expect(bundled).toEqual([]);
  });

  it('folds in AgentImport edges, marking how they are bundled', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      agent: {
        ...agentInA,
        imports: [{
          parentAgentId: 'agent-aaa', importedAgentId: 'agent-cal', position: 0, required: true,
          importedAgent: { id: 'agent-cal', name: 'Calendar', urn: 'hrn:agent:acme.com:calendar' },
        }],
      },
      apps: [],
    });
    expect(bundled).toHaveLength(1);
    expect(bundled[0]).toMatchObject({ id: 'agent-cal', name: 'Calendar', via: 'Import (required)' });
  });

  it('de-duplicates an agent that is both imported and co-installed', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      agent: {
        ...agentInA,
        imports: [{
          parentAgentId: 'agent-aaa', importedAgentId: 'agent-iris', position: 0, required: false,
          importedAgent: { id: 'agent-iris', name: 'Iris', urn: 'hrn:agent:acme.com:iris' },
        }],
      },
      apps: [{
        id: 'app-1', name: 'Team App', urn: 'urn:app:1', organizationId: 'org-a',
        agentId: 'agent-aaa', agents: [selfLite, iris],
      }],
    });
    expect(bundled).toHaveLength(1);
    // The richer co-installed row wins — it carries the persona fields.
    expect(bundled[0]).toMatchObject({ id: 'agent-iris', via: 'Team App', personaRole: 'backend-engineer' });
  });
});

// ── #714 review follow-ups ──────────────────────────────────────────────────

describe('/app/agents/[id] loader — bundles across app OWNERSHIP classes (#714 review)', () => {
  const selfLite = {
    id: 'agent-aaa', name: 'Agent in A', urn: 'urn:agent:a',
    description: null, personaName: null, personaRole: null,
  };
  const nova = {
    id: 'agent-nova', name: 'Nova', urn: 'hrn:agent:ada:nova',
    description: 'personal persona', personaName: 'Nova', personaRole: 'mobile-engineer',
  };

  it('finds siblings in a USER-OWNED app — apps() unfiltered never returns one', async () => {
    // `apps()` routes on ORG MEMBERSHIP (App carries no userId), so an org-less
    // App only comes back through filter.ownedByMe (#782). Sourcing bundles from
    // the unfiltered list alone hid every personal team App.
    routeMock({
      agent: { data: { agent: agentInA } },
      myOrgs: { data: { organizations: [orgA] } },
      apps: { data: [] },
      ownedApps: { data: [{
        id: 'app-personal', name: 'My Team', urn: 'urn:app:mine', organizationId: null,
        agentId: 'agent-aaa', agents: [selfLite, nova],
      }] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      bundledAgents: Array<{ id: string; via: string }>;
      installedApps: Array<{ id: string }>;
    };
    expect(result.bundledAgents.map((a) => a.id)).toEqual(['agent-nova']);
    expect(result.bundledAgents[0].via).toBe('My Team');
    // The Apps tab was blind to the same app.
    expect(result.installedApps.map((a) => a.id)).toEqual(['app-personal']);
  });

  it('de-duplicates an app returned by BOTH lists (a platform admin sees overlap)', async () => {
    const app = {
      id: 'app-1', name: 'Team App', urn: 'urn:app:1', organizationId: null,
      agentId: 'agent-aaa', agents: [selfLite, nova],
    };
    routeMock({
      agent: { data: { agent: agentInA } },
      myOrgs: { data: { organizations: [orgA] } },
      apps: { data: [app] },
      ownedApps: { data: [app] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      bundledAgents: unknown[];
      installedApps: unknown[];
    };
    expect(result.installedApps).toHaveLength(1);
    expect(result.bundledAgents).toHaveLength(1);
  });

  it('carries an IMPORTED agent\'s role and description instead of blanking them', async () => {
    // AGENT_FIELDS selected only { id urn name } for importedAgent, so an
    // import-sourced row rendered "—" in Role and Description even when the
    // imported agent had values.
    routeMock({
      agent: { data: { agent: {
        ...agentInA,
        imports: [{
          parentAgentId: 'agent-aaa', importedAgentId: 'agent-cal', position: 0, required: false,
          importedAgent: {
            id: 'agent-cal', name: 'Calendar', urn: 'hrn:agent:acme.com:calendar',
            description: 'Books meetings', personaName: 'Cal', personaRole: 'scheduler',
          },
        }],
      } } },
      myOrgs: { data: { organizations: [orgA] } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as {
      bundledAgents: Array<{ personaRole: string | null; description: string | null; via: string }>;
    };
    expect(result.bundledAgents[0]).toMatchObject({
      personaRole: 'scheduler',
      description: 'Books meetings',
      via: 'Import',
    });
  });
});
