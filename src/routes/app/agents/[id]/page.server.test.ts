import { AGENT_EXTENSIONS_QUERY, AGENT_SYSTEM_MEMORY_IDENTITY_QUERY } from '$lib/server/agent-profile';
import { TESTER_OWNED_AGENT_IDS_QUERY } from '$lib/server/agent-tester/link-eligibility';
import { SELF_AGENT_MANAGE_QUERY, AGENT_INDEX_REFS_QUERY } from '$lib/server/agent-inheritance-write';
/**
 * Spec 018 — /app/agents/[id] detail-page loader tests.
 *
 * Pattern mirrors `src/routes/app/orgs/[id]/page.server.test.ts`:
 * mock `$lib/server/api`'s `gqlClient`, import `load` from
 * `+page.server.ts`, call it with a hand-rolled event. We do NOT spin
 * up SvelteKit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, visit, type FieldNode, type SelectionSetNode } from 'graphql';
import {
  AGENT_QUERY,
  SELF_CAN_MANAGE_QUERY,
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
  AGENT_REGISTER_DEFAULTS_QUERY,
  AGENT_RESET_CONTEXT_QUERY,
  UPDATE_AGENT_RESET_CONTEXT_MUTATION,
  UPDATE_AGENT_MUTATION,
  UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION,
  APP_ORG_AGENT_GRANTS_QUERY,
  PUBLISH_AGENT_IMPORT_MUTATION,
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
  registerDefaults?: { data?: unknown; error?: unknown };
  resetContext?: { data?: unknown; error?: unknown };
  orgAgents?: { data?: unknown; error?: unknown };
  extensions?: { data?: unknown; error?: unknown };
  systemIdentity?: { data?: unknown; error?: unknown };
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === AGENT_EXTENSIONS_QUERY) {
      if (opts.extensions?.error) throw opts.extensions.error;
      return opts.extensions?.data ?? { agent: { extendedBy: { items: [], endCursor: null, hasMore: false } } };
    }
    if (query === AGENT_SYSTEM_MEMORY_IDENTITY_QUERY) {
      if (opts.systemIdentity?.error) throw opts.systemIdentity.error;
      return opts.systemIdentity?.data ?? { memory: null };
    }
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
      if (opts.apps?.error !== undefined) throw opts.apps.error;
      const apps = (opts.apps?.data as unknown[]) ?? [];
      return { apps: { items: apps, total: apps.length } };
    }
    // The org-less companion (filter.ownedByMe) is a SEPARATE document — the
    // loader catches its failure, so an unmocked one would degrade silently
    // instead of failing the test.
    if (query === AGENT_OWNED_APPS_QUERY) {
      if (opts.ownedApps?.error !== undefined) throw opts.ownedApps.error;
      const apps = (opts.ownedApps?.data as unknown[]) ?? [];
      return { apps: { items: apps, total: apps.length } };
    }
    // #942: routed explicitly — the loader catches its failure into a null
    // sentinel, so an unmocked query would pass as "could not load".
    if (query === AGENT_REGISTER_DEFAULTS_QUERY) {
      if (opts.registerDefaults?.error !== undefined) throw opts.registerDefaults.error;
      return opts.registerDefaults?.data ?? { agent: { id: 'agent-id-123', registerDefaults: { mentionOnly: false } } };
    }
    // #1275: its own read, so a server without the field costs only this control.
    if (query === AGENT_RESET_CONTEXT_QUERY) {
      if (opts.resetContext?.error !== undefined) throw opts.resetContext.error;
      return opts.resetContext?.data ?? { agent: { id: 'agent-id-123', resetContextAfterTask: false } };
    }
    // #1173: the Bundled tab's candidates, a request of its own (a refusal
    // costs the add control, never the page).
    if (query === APP_ORG_AGENT_GRANTS_QUERY) {
      if (opts.orgAgents?.error !== undefined) throw opts.orgAgents.error;
      return opts.orgAgents?.data ?? { organization: { id: 'org-a', agentOrgGrants: [] } };
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
  it.each([false, true])('#2100: keeps management separate from Tester owner eligibility (owned=%s)', async (owned) => {
    routeMock({ agent: { data: { agent: personalAgent } } });
    const fallback = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (query, vars) => {
      if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
      if (query === TESTER_OWNED_AGENT_IDS_QUERY) {
        return { agents: { items: owned ? [{ id: personalAgent.id }] : [], total: owned ? 1 : 0 } };
      }
      return fallback(query, vars);
    });
    const event = ev({ agentId: personalAgent.id });
    Object.assign(event.locals, { user: { id: 'viewer', roles: ['ADMIN'] } });
    const result = await (await importLoad())(event) as { canManageAgent: boolean; canOpenTester: boolean };
    expect(result.canManageAgent).toBe(true);
    expect(result.canOpenTester).toBe(owned);
    expect(mockRequest).toHaveBeenCalledWith(TESTER_OWNED_AGENT_IDS_QUERY, { limit: 200, offset: 0 });
  });

  it.each([false, true])('#2187: an org-owned Agent offers the Tester only where the org agents list shows it (listed=%s)', async (listed) => {
    routeMock({
      agent: { data: { agent: agentInA } },
      myOrgs: { data: { organizations: [{ ...orgA, agents: listed ? [agentInA] : [] }] } },
    });
    const fallback = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (query, vars) => {
      if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
      if (query === TESTER_OWNED_AGENT_IDS_QUERY) return { agents: { items: [], total: 0 } };
      return fallback(query, vars);
    });
    const event = ev({ agentId: agentInA.id });
    Object.assign(event.locals, { user: { id: 'viewer', roles: ['ADMIN'] } });
    const result = await (await importLoad())(event) as { canManageAgent: boolean; canOpenTester: boolean };
    expect(result.canManageAgent).toBe(true);
    expect(result.canOpenTester).toBe(listed);
  });

  // #2183: the helper tests pin the skip paths; these pin the loader wiring (what
  // it asks the access check and passes the helper), so a regression there
  // fails here too. Each case answers the management query and records it.
  const loadWithManagement = async (
    agent: typeof agentInA | typeof personalAgent,
    answer: { effectiveAccess: { canManage: boolean | null } } | Error,
    orgs: unknown[],
  ) => {
    // Calls are judged per load: a second load in one test must not see the first's.
    mockRequest.mockClear();
    routeMock({ agent: { data: { agent } }, myOrgs: { data: { organizations: orgs } } });
    const fallback = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (query, vars) => {
      if (query === SELF_CAN_MANAGE_QUERY) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
      return fallback(query, vars);
    });
    const event = ev({ agentId: agent.id });
    Object.assign(event.locals, { user: { id: 'viewer', roles: ['ADMIN'] } });
    const result = await (await importLoad())(event) as { canOpenTester: boolean | null };
    return {
      canOpenTester: result.canOpenTester,
      askedOwned: mockRequest.mock.calls.some(([q]) => q === TESTER_OWNED_AGENT_IDS_QUERY),
    };
  };

  it('#2183: the loader asks the access check about the viewer and this Agent', async () => {
    await loadWithManagement(agentInA, { effectiveAccess: { canManage: true } }, [{ ...orgA, agents: [agentInA] }]);
    expect(mockRequest).toHaveBeenCalledWith(SELF_CAN_MANAGE_QUERY, { user: 'viewer', resource: agentInA.urn });
  });

  it('#2183: a manager of an org-listed Agent gets the Tester without the ownership read, and the manager signal decides it', async () => {
    const listed = [{ ...orgA, agents: [agentInA] }];
    const manager = await loadWithManagement(agentInA, { effectiveAccess: { canManage: true } }, listed);
    expect(manager).toEqual({ canOpenTester: true, askedOwned: false });
    // Same listed Agent, same org: only the management answer differs.
    const notManager = await loadWithManagement(agentInA, { effectiveAccess: { canManage: false } }, listed);
    expect(notManager).toEqual({ canOpenTester: false, askedOwned: false });
  });

  it.each([
    { label: 'false', answer: { effectiveAccess: { canManage: false } }, expected: false },
    { label: 'null', answer: { effectiveAccess: { canManage: null } }, expected: null },
    { label: 'a failed read', answer: new Error('access outage'), expected: null },
  ])('#2183: when the management check is $label the ownership read is skipped and canOpenTester=$expected', async ({ answer, expected }) => {
    // Only a manager reaches the ownership read (the #2100 tests above pin the
    // read being made for a manager); a non-manager or unknown never does.
    const out = await loadWithManagement(personalAgent, answer, [orgA]);
    expect(out).toEqual({ canOpenTester: expected, askedOwned: false });
    expect(mockRequest).toHaveBeenCalledWith(SELF_CAN_MANAGE_QUERY, { user: 'viewer', resource: personalAgent.urn });
  });

  it('#2187: the page reads organizations with ORGANIZATIONS_QUERY, paged from offset 0', async () => {
    routeMock({ agent: { data: { agent: agentInA } }, myOrgs: { data: { organizations: [orgA] } } });
    const event = ev({ agentId: agentInA.id });
    Object.assign(event.locals, { user: { id: 'viewer', roles: ['ADMIN'] } });
    await (await importLoad())(event);
    expect(mockRequest).toHaveBeenCalledWith(ORGANIZATIONS_QUERY, expect.objectContaining({ offset: 0 }));
  });

  it('#2187: a failed org read rejects the page load; it never reaches the link as an empty list', async () => {
    routeMock({ agent: { data: { agent: agentInA } }, myOrgs: { error: new Error('org outage') } });
    const event = ev({ agentId: agentInA.id });
    Object.assign(event.locals, { user: { id: 'viewer', roles: ['ADMIN'] } });
    await expect((await importLoad())(event)).rejects.toThrow('org outage');
  });

  it('#1226: a failed Nodes-tab read (any page) is agentNodesError, not an empty memory', async () => {
    routeMock({
      agent: { data: { agent: { ...agentInA, memoryItems: [{ memory: { id: 'mem-1' }, role: 'read' }] } } },
      myOrgs: { data: { organizations: [orgA] } },
      nodes: { error: new Error('page 2 outage') },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-aaa' }))) as { agentNodes: unknown[]; agentNodesError: boolean };
    expect(result.agentNodesError).toBe(true);
    expect(result.agentNodes).toEqual([]);
  });

  it('#472: a failed Apps read (either call) is installedAppsError, and the other call\'s rows survive', async () => {
    const lite = (id: string) => ({ id, name: id, urn: `hrn:app:x:${id}`, organizationId: 'org-a', appAgents: [{ agent: { id: 'agent-aaa' } }], agents: [] });
    const run = async (opts: Parameters<typeof routeMock>[0]) => {
      routeMock({ agent: { data: { agent: agentInA } }, myOrgs: { data: { organizations: [orgA] } }, ...opts });
      const load = await importLoad();
      return (await load(ev({ agentId: 'agent-aaa' }))) as { installedApps: Array<{ id: string }>; installedAppsError: boolean };
    };
    const ok = await run({ apps: { data: [lite('one')] } });
    expect(ok.installedAppsError).toBe(false);
    const orgFailed = await run({ apps: { error: new Error('outage') }, ownedApps: { data: [lite('mine')] } });
    expect(orgFailed.installedAppsError).toBe(true);
    expect(orgFailed.installedApps.map((a) => a.id)).toEqual(['mine']);
    const ownedFailed = await run({ apps: { data: [lite('one')] }, ownedApps: { error: new Error('outage') } });
    expect(ownedFailed.installedAppsError).toBe(true);
    expect(ownedFailed.installedApps.map((a) => a.id)).toEqual(['one']);
  });

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

  // #1339: a readable agent whose org the caller is not a member of (a cross-org
  // PUBLIC agent) renders without org chrome. The server's agent(ref:) gate is
  // the only authority on whether it is readable; the org list is chrome.
  it('#1339: a cross-org PUBLIC agent loads with org null instead of 404', async () => {
    routeMock({
      agent: { data: { agent: { ...agentInB, visibility: 'PUBLIC' } } },
      myOrgs: { data: { organizations: [orgA] } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as {
      agent: typeof agentInB;
      org: unknown;
      orgSystemMemories: unknown[];
      personalMemories: unknown[];
    };
    expect(result.agent.id).toBe('agent-bbb');
    expect(result.org).toBeNull();
    expect(result.orgSystemMemories).toEqual([]);
    // The foreign org's own surface is never requested on the caller's behalf.
    expect(mockRequest).not.toHaveBeenCalledWith(ORG_SYSTEM_MEMORIES_QUERY, expect.anything());
  });

  it('#1339: a foreign-org agent is not mistaken for the caller’s own org-less agent', async () => {
    // org is null here too, but the agent belongs to an organization, so the
    // "caller owns it" personal-memory offer must not run.
    routeMock({
      agent: { data: { agent: { ...agentInB, visibility: 'ORGANIZATION' } } },
      myOrgs: { data: { organizations: [orgA] } },
      personalMems: { data: [{ id: 'pm1', name: 'my notes', urn: 'u', class: 'personal', organizationId: null }] },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-bbb' }))) as { personalMemories: unknown[] };
    expect(result.personalMemories).toEqual([]);
    expect(mockRequest).not.toHaveBeenCalledWith(PERSONAL_MEMORIES_LITE_QUERY, expect.anything());
  });

  it('#1339: an agent the server refuses still 404s, whoever the caller’s orgs are', async () => {
    routeMock({
      agent: { data: { agent: null } },
      myOrgs: { data: { organizations: [orgA, orgB] } },
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
// non-obvious one: co-installing an agent into the same App writes NO
// AgentImport edge, so an App's roster-mates are its co-installed SIBLINGS.
// AgentImport edges are folded in on top.
//
// #974: these rows are ROLE-ACTORS, so they carry `personaRole` and no name of
// a person — `Agent.personaName` no longer exists. Who is cast in the App is
// its Worker staff, listed on the App page.

describe('/app/agents/[id] loader — bundled agents (#713)', () => {
  const backend = {
    id: 'agent-backend', name: 'Backend Engineer', urn: 'hrn:agent:acme.com:backend-engineer',
    description: 'AI coding agent', personaRole: 'backend-engineer',
  };
  const frontend = {
    id: 'agent-frontend', name: 'Frontend Engineer', urn: 'hrn:agent:acme.com:frontend-engineer',
    description: null, personaRole: 'frontend-engineer',
  };
  const selfLite = {
    id: 'agent-aaa', name: 'Agent in A', urn: 'urn:agent:a',
    description: null, personaRole: null,
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

  // #472 / hadron-server#2343: both App reads carry the agent filter, so the load
  // no longer drains every App the caller can see. Pinned on the variables the
  // request actually carried (the mock ignores them otherwise), for BOTH documents.
  it('asks the server for only this agent\'s Apps, on the member read and the org-less read', async () => {
    await loadBundled({ apps: [], ownedApps: [] });
    const filtered = (doc: string) =>
      mockRequest.mock.calls.filter(([q]) => q === doc).map(([, v]) => v);
    expect(filtered(AGENT_APPS_QUERY)).toEqual([expect.objectContaining({ agentId: 'agent-aaa' })]);
    expect(filtered(AGENT_OWNED_APPS_QUERY)).toEqual([expect.objectContaining({ agentId: 'agent-aaa' })]);
    // The filter is declared in the documents themselves, not just sent.
    expect(AGENT_APPS_QUERY).toContain('filter: { agentId: $agentId }');
    expect(AGENT_OWNED_APPS_QUERY).toContain('filter: { ownedByMe: true, agentId: $agentId }');
  });

  it('lists the co-installed siblings, excluding the agent itself', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      apps: [{
        id: 'app-1', name: 'Team App', urn: 'urn:app:1', organizationId: 'org-a',
        appAgents: [{ agent: { id: 'agent-aaa' } }], agents: [selfLite, backend, frontend],
      }],
    });
    expect(bundled.map((a) => a.id)).toEqual(['agent-backend', 'agent-frontend']);
    expect(bundled[0]).toMatchObject({ name: 'Backend Engineer', personaRole: 'backend-engineer', via: 'Team App' });
  });

  it('portal#1684: a derived sibling says so in its via; a row or a withheld answer doesn\u2019t', async () => {
    const importer = { id: 'agent-aaa', name: 'Team Lead', urn: 'hrn:agent:acme.com:lead' };
    const row = (id: string, installMethod: string | null, imp: unknown = null) => ({ agent: { id }, installMethod, importer: imp });
    const app = (id: string, appAgents: unknown) => ({ id, name: `App ${id}`, urn: `urn:app:${id}`, organizationId: 'org-a', appAgents, agents: [selfLite, backend, frontend] });
    const derived = await loadBundled({ apps: [app('1', [row('agent-aaa', 'ROW'), row('agent-backend', 'DERIVED', importer), row('agent-frontend', 'ROW')])] });
    expect(derived.bundledAgents.map((a) => a.via)).toEqual(['App 1, derived from Team Lead', 'App 1']);
    const withheld = await loadBundled({ apps: [app('2', [row('agent-aaa', null), row('agent-backend', null), row('agent-frontend', null)])] });
    expect(withheld.bundledAgents.map((a) => a.via)).toEqual(['App 2', 'App 2']);
  });

  // portal#1350: App.agents drops an unreadable Agent and App.agentId is masked, so the only
  // signal is an `appAgents` row whose `agent` is null. Pins the real nullable AppAgent shape.
  type Flag = { bundledAgents: Array<{ id: string }>; installedApps: Array<{ id: string }>; bundledMayBeIncomplete?: boolean };
  const hiddenRow = { agent: null };
  const row = (id: string) => ({ agent: { id } });
  const app = (id: string, appAgents: unknown, agents: unknown[] = [selfLite]) =>
    ({ id, name: id, urn: `urn:app:${id}`, organizationId: 'org-a', appAgents, agents });

  it('flags a hidden PRIMARY with a readable secondary: the secondary stays, the notice is on', async () => {
    const r = (await loadBundled({ apps: [app('app-1', [hiddenRow, row('agent-aaa'), row('agent-backend')], [selfLite, backend])] })) as Flag;
    expect(r.bundledAgents.map((a) => a.id)).toEqual(['agent-backend']);
    expect(r.bundledMayBeIncomplete).toBe(true);
  });

  it('flags a readable primary with a hidden SECONDARY', async () => {
    const r = (await loadBundled({ apps: [app('app-1', [row('agent-aaa'), hiddenRow])] })) as Flag;
    expect(r.installedApps.map((a) => a.id)).toEqual(['app-1']);
    expect(r.bundledMayBeIncomplete).toBe(true);
  });

  it('flags an App where only hidden installs exist (this agent unknown)', async () => {
    const r = (await loadBundled({ apps: [app('app-3', [hiddenRow], [])] })) as Flag;
    expect(r.bundledMayBeIncomplete).toBe(true);
    expect(r.bundledAgents).toEqual([]);
  });

  it('reads the signal from the org-less read too, and a duplicate across both reads still yields one boolean', async () => {
    const a = app('app-9', [row('agent-aaa'), hiddenRow]);
    const r = (await loadBundled({ apps: [a], ownedApps: [a] })) as Flag;
    expect(r.installedApps.map((x) => x.id)).toEqual(['app-9']);
    expect(r.bundledMayBeIncomplete).toBe(true);
    const own = (await loadBundled({ ownedApps: [app('app-o', [row('agent-aaa'), hiddenRow])] })) as Flag;
    expect(own.bundledMayBeIncomplete).toBe(true);
  });

  it('all-readable control: no notice', async () => {
    const r = (await loadBundled({ apps: [app('app-1', [row('agent-aaa'), row('agent-backend')], [selfLite, backend])] })) as Flag;
    expect(r.bundledMayBeIncomplete).toBe(false);
  });

  it('known-empty control: an App with a real empty join is not flagged', async () => {
    const r = (await loadBundled({ apps: [app('app-1', [], [])] })) as Flag;
    expect(r.bundledMayBeIncomplete).toBe(false);
  });

  it('malformed appAgents is unknown, never proof of completeness', async () => {
    for (const bad of [null, undefined]) {
      const r = (await loadBundled({ apps: [app('app-1', bad)] })) as Flag;
      expect(r.bundledMayBeIncomplete).toBe(true);
    }
  });

  it('payload carries a boolean only: no legacy count key', async () => {
    const r = (await loadBundled({ apps: [app('app-1', [row('agent-aaa'), hiddenRow, hiddenRow])] })) as Record<string, unknown>;
    expect(r.bundledMayBeIncomplete).toBe(true);
    expect('bundledWithheldApps' in r).toBe(false);
  });

  it('selects the join, not the masked primary id, in both App documents', () => {
    // Parsed, so a reflow or a reordered selection can't fail it and a look-alike in a comment can't pass it.
    const fields = (set: SelectionSetNode | undefined) =>
      Object.fromEntries((set?.selections ?? []).filter((n): n is FieldNode => n.kind === 'Field').map((n) => [n.name.value, n.selectionSet]));
    const names = (set: SelectionSetNode | undefined) => Object.keys(fields(set)).sort();
    for (const doc of [AGENT_APPS_QUERY, AGENT_OWNED_APPS_QUERY]) {
      const found: SelectionSetNode[] = [];
      visit(parse(doc), { Field: (n) => { if (n.name.value === 'appAgents' && n.selectionSet) found.push(n.selectionSet); } });
      expect(found).toHaveLength(1);
      expect(names(found[0])).toEqual(['agent', 'importer', 'installMethod']);
      expect(names(fields(found[0]).agent)).toEqual(['id']);
      expect(names(fields(found[0]).importer)).toEqual(['id', 'name', 'urn']);
      expect(doc).not.toMatch(/^\s+agentId\s*$/m);
    }
  });

  it('ignores apps this agent is not installed in', async () => {
    const { bundledAgents: bundled } = await loadBundled({
      apps: [{
        id: 'app-2', name: 'Someone Else', urn: 'urn:app:2', organizationId: 'org-a',
        appAgents: [{ agent: { id: 'agent-zzz' } }], agents: [{ ...backend, id: 'agent-other' }],
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
          parentAgentId: 'agent-aaa', importedAgentId: 'agent-backend', position: 0, required: false,
          importedAgent: { id: 'agent-backend', name: 'Backend Engineer', urn: 'hrn:agent:acme.com:backend-engineer' },
        }],
      },
      apps: [{
        id: 'app-1', name: 'Team App', urn: 'urn:app:1', organizationId: 'org-a',
        appAgents: [{ agent: { id: 'agent-aaa' } }], agents: [selfLite, backend],
      }],
    });
    expect(bundled).toHaveLength(1);
    // The richer co-installed row wins — it carries the persona fields.
    expect(bundled[0]).toMatchObject({ id: 'agent-backend', via: 'Team App', personaRole: 'backend-engineer' });
  });
});

// ── #714 review follow-ups ──────────────────────────────────────────────────

describe('/app/agents/[id] loader — bundles across app OWNERSHIP classes (#714 review)', () => {
  const selfLite = {
    id: 'agent-aaa', name: 'Agent in A', urn: 'urn:agent:a',
    description: null, personaRole: null,
  };
  const nova = {
    id: 'agent-nova', name: 'Mobile Engineer', urn: 'hrn:agent:ada:mobile-engineer',
    description: 'personal role-actor', personaRole: 'mobile-engineer',
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
        appAgents: [{ agent: { id: 'agent-aaa' } }], agents: [selfLite, nova],
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
      appAgents: [{ agent: { id: 'agent-aaa' } }], agents: [selfLite, nova],
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
            description: 'Books meetings', personaRole: 'scheduler',
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

// ── #942: the install-row register default ─────────────────────────────────

/** A graphql-request ClientError as the server sends it: a GraphQL errors payload. */
function gqlError(code: string, message: string) {
  return Object.assign(new Error(message), {
    response: { errors: [{ message, extensions: { code } }], status: 200 },
  });
}

async function runRegisterDefaults(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.updateRegisterDefaults(actionEv(fields));
}

describe('/app/agents/[id] register default (#942)', () => {
  it('loads the current default and seeds the form with it', async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      registerDefaults: { data: { agent: { id: 'agent-personal', registerDefaults: { mentionOnly: true } } } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as {
      registerDefaults: { mentionOnly: boolean } | null;
      registerDefaultsForm: { data: { mentionOnly: boolean } };
    };
    expect(result.registerDefaults).toEqual({ mentionOnly: true });
    expect(result.registerDefaultsForm.data.mentionOnly).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(AGENT_REGISTER_DEFAULTS_QUERY, { ref: 'agent-personal' });
  });

  it('a failed read is the null sentinel, never a default of "off"', async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      registerDefaults: { error: new Error('boom') },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as { registerDefaults: unknown };
    expect(result.registerDefaults).toBeNull();
  });

  it('sends ONLY registerDefaults, with a checked box as true', async () => {
    mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-id-123', registerDefaults: { mentionOnly: true } } });
    const result = await runRegisterDefaults({ _kind: 'registerDefaults', mentionOnly: 'on' });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Saved. Future installs use this.' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [query, vars] = mockRequest.mock.calls[0];
    expect(query).toBe(UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION);
    expect(vars).toEqual({ ref: 'agent-id-123', registerDefaults: { mentionOnly: true } });
  });

  it('an unchecked box (absent from the POST) saves false', async () => {
    mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-id-123', registerDefaults: { mentionOnly: false } } });
    await runRegisterDefaults({ _kind: 'registerDefaults' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'agent-id-123', registerDefaults: { mentionOnly: false } });
  });

  it('rejects another form\'s discriminator before calling the API', async () => {
    const result = await runRegisterDefaults({ _kind: 'agentSettings', mentionOnly: 'on' });
    expect(superFormFrom(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('the untyped owner-gate refusal gets the fixed message, never the server text', async () => {
    mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR', 'Forbidden'));
    const result = await runRegisterDefaults({ _kind: 'registerDefaults', mentionOnly: 'on' });
    const msg = superFormFrom(result)?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).toBe('The default was not saved. Changing it needs the agent’s owner or an organization admin.');
    expect(msg.text).not.toContain('Forbidden');
  });

  it('maps a typed FORBIDDEN and AGENT_NOT_FOUND to their own messages', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    const forbidden = await runRegisterDefaults({ _kind: 'registerDefaults' });
    expect((superFormFrom(forbidden)?.message as { text: string }).text).toBe('Only the agent’s owner or an organization admin can change this.');
    mockRequest.mockRejectedValueOnce(gqlError('AGENT_NOT_FOUND', 'AGENT_NOT_FOUND: agent-id-123'));
    const missing = await runRegisterDefaults({ _kind: 'registerDefaults' });
    expect((superFormFrom(missing)?.message as { text: string }).text).toBe('This agent is not available to you.');
  });
});

async function runResetContext(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.updateResetContext(actionEv(fields));
}

describe('/app/agents/[id] context reset after a task (#1275)', () => {
  it('loads the server value and seeds the form with it', async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      resetContext: { data: { agent: { id: 'agent-personal', resetContextAfterTask: true } } },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as {
      resetContext: unknown;
      resetContextForm: { data: { resetContextAfterTask: boolean } };
    };
    expect(result.resetContext).toEqual({ kind: 'ok', value: true });
    expect(result.resetContextForm.data.resetContextAfterTask).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(AGENT_RESET_CONTEXT_QUERY, { ref: 'agent-personal' });
  });

  it('a server without the field (validation failure) is "absent": no control, no error', async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      resetContext: { error: gqlError('GRAPHQL_VALIDATION_FAILED', 'Cannot query field "resetContextAfterTask" on type "Agent".') },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as { resetContext: unknown };
    expect(result.resetContext).toEqual({ kind: 'absent' });
  });

  it('any other failed read is "failed", never a value of "off"', async () => {
    routeMock({
      agent: { data: { agent: personalAgent } },
      resetContext: { error: new Error('boom') },
    });
    const load = await importLoad();
    const result = (await load(ev({ agentId: 'agent-personal' }))) as { resetContext: unknown };
    expect(result.resetContext).toEqual({ kind: 'failed' });
  });

  it('sends ONLY resetContextAfterTask, with a checked box as true', async () => {
    mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-id-123', resetContextAfterTask: true } });
    const result = await runResetContext({ _kind: 'resetContext', resetContextAfterTask: 'on' });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Saved.' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [query, vars] = mockRequest.mock.calls[0];
    expect(query).toBe(UPDATE_AGENT_RESET_CONTEXT_MUTATION);
    expect(vars).toEqual({ ref: 'agent-id-123', resetContextAfterTask: true });
  });

  it('an unchecked box (absent from the POST) clears it with an explicit false', async () => {
    mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-id-123', resetContextAfterTask: false } });
    await runResetContext({ _kind: 'resetContext' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'agent-id-123', resetContextAfterTask: false });
  });

  it('rejects another form\'s discriminator before calling the API', async () => {
    const result = await runResetContext({ _kind: 'registerDefaults', resetContextAfterTask: 'on' });
    expect(superFormFrom(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('the Agent settings save never sends the field, by omission or by default', () => {
    expect(UPDATE_AGENT_MUTATION).not.toMatch(/resetContextAfterTask/);
  });

  it('a refusal renders as text, not the server wording', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'Forbidden'));
    const refused = await runResetContext({ _kind: 'resetContext', resetContextAfterTask: 'on' });
    const msg = superFormFrom(refused)?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).toBe('Not saved. Changing this needs the agent’s owner or an organization admin.');
    expect(msg.text).not.toContain('Forbidden');
    mockRequest.mockRejectedValueOnce(gqlError('AGENT_NOT_FOUND', 'AGENT_NOT_FOUND: agent-id-123'));
    const missing = await runResetContext({ _kind: 'resetContext' });
    expect((superFormFrom(missing)?.message as { text: string }).text).toBe('This agent is not available to you.');
  });
});

it('gives the inheritance forms distinct stable ids among all loaded forms', async () => {
  routeMock({ agent: { data: { agent: personalAgent } } });
  const load = await importLoad();
  const result = await load(ev()) as unknown as Record<string, unknown>;
  const ids = Object.values(result).filter((value): value is { id: string } => !!value && typeof value === 'object' && 'valid' in value && 'id' in value).map(value => value.id);
  expect(ids.filter(id => id === 'agentBase')).toHaveLength(1);
  expect(ids.filter(id => id === 'agentIndexRefs')).toHaveLength(1);
});

it('self-audits the actual loaded Agent by full URN, never its ambiguous id', async () => {
  routeMock({ agent: { data: { agent: { ...personalAgent, urn: 'hrn:agent:example.com:child' } } } });
  const fallback = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (query: string, variables: Record<string, unknown>) => {
    if (query === SELF_AGENT_MANAGE_QUERY) {
      if (variables.resource !== 'hrn:agent:example.com:child' || variables.user !== 'me') throw new Error('Resource not found');
      return { effectiveAccess: { canManage: true } };
    }
    if (query === AGENT_INDEX_REFS_QUERY) return { agent: { extendsAgentId: 'raw-base-id', tasksIndexRef: null, processesIndexRef: null } };
    return fallback(query, variables);
  });
  const load = await importLoad();
  const result = await load({ ...ev(), locals: { token: 'token', user: { id: 'me' }, impersonation: null } } as never) as unknown as { inheritanceManagement: { canManage: boolean; error: string | null }; baseForm: { data: { baseRef: string } } };
  expect(result.baseForm.data.baseRef).toBe('');
  expect(result.inheritanceManagement).toMatchObject({ canManage: true, error: null });
});

describe('/app/agents/[id] — add a bundled agent (#1173)', () => {
  const helper = { id: 'agent-helper', name: 'Helper', urn: 'hrn:agent:acme.com:helper' };
  const subscribed = { id: 'agent-sub', name: 'Project Manager', urn: 'hrn:agent:hadronmemory.com:project-manager' };
  const already = { id: 'agent-cal', name: 'Calendar', urn: 'hrn:agent:acme.com:calendar' };
  const self = { id: 'agent-aaa', name: 'Agent in A', urn: 'urn:agent:a' };

  async function loadCandidates(orgAgents: { data?: unknown; error?: unknown }, agentOver: Record<string, unknown> = {}) {
    routeMock({
      agent: { data: { agent: { ...agentInA, ...agentOver } } },
      myOrgs: { data: { organizations: [orgA] } },
      orgAgents,
    });
    const load = await importLoad();
    return (await load(ev({ agentId: 'agent-aaa' }))) as {
      bundleCandidates: Array<{ id: string }>;
      bundleCandidatesError: boolean;
      nextImportPosition: number;
    };
  }

  it('offers only the agents the org is licensed for, minus itself and what it already bundles', async () => {
    const r = await loadCandidates(
      {
        data: {
          organization: {
            id: 'org-a',
            // Owned agents are NOT offered: the server refuses them (an org
            // cannot grant itself an agent), so they would be dead choices.
            agents: [self, helper, already],
            agentOrgGrants: [
              { isActive: true, agent: subscribed },
              { isActive: true, agent: already },
              { isActive: true, agent: self },
              { isActive: true, agent: null },
              { isActive: false, agent: { id: 'agent-x', name: 'X', urn: 'u' } },
              { isActive: true, revokedAt: '2026-01-01T00:00:00Z', agent: { id: 'agent-y', name: 'Y', urn: 'u2' } },
            ],
          },
        },
      },
      { imports: [{ parentAgentId: 'agent-aaa', importedAgentId: 'agent-cal', position: 4, required: true, importedAgent: already }] },
    );
    expect(r.bundleCandidates.map((a) => a.id)).toEqual(['agent-sub']);
    expect(r.bundleCandidatesError).toBe(false);
    expect(r.nextImportPosition).toBe(5);
  });

  it('an import the viewer cannot read still counts as bundled, so it is not offered again', async () => {
    const r = await loadCandidates(
      { data: { organization: { id: 'org-a', agents: [], agentOrgGrants: [{ isActive: true, agent: helper }] } } },
      { imports: [{ parentAgentId: 'agent-aaa', importedAgentId: 'agent-helper', position: 1, required: false, importedAgent: null }] },
    );
    expect(r.bundleCandidates).toEqual([]);
  });

  it('a refusing candidates request costs the add control, not the page', async () => {
    const r = await loadCandidates({ error: new Error('boom') });
    expect(r.bundleCandidates).toEqual([]);
    expect(r.bundleCandidatesError).toBe(true);
  });

  it('publishes the import with the chosen agent, position and required flag', async () => {
    mockRequest.mockResolvedValue({ publishAgentImport: { importedAgentId: 'agent-helper' } });
    const { actions } = await importMod();
    const result = await actions.addBundledAgent(
      actionEv({ agentId: 'agent-helper', position: '3', required: 'on' }) as never,
    );
    expect(mockRequest).toHaveBeenCalledWith(PUBLISH_AGENT_IMPORT_MUTATION, {
      importedAgentRef: 'agent-helper',
      parentAgentRef: 'agent-id-123',
      position: 3,
      required: true,
    });
    expect(result).toMatchObject({ bundleAdded: true });
  });

  it('an unticked required box publishes an optional import', async () => {
    mockRequest.mockResolvedValue({ publishAgentImport: { importedAgentId: 'agent-helper' } });
    const { actions } = await importMod();
    await actions.addBundledAgent(actionEv({ agentId: 'agent-helper', position: '1' }) as never);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ required: false });
  });

  it('refuses a missing agent or a bad position before calling the API', async () => {
    const { actions } = await importMod();
    const bad: Array<Record<string, string>> = [{ position: '1' }, { agentId: 'agent-helper', position: '0' }, { agentId: 'agent-helper', position: 'x' }];
    for (const fields of bad) {
      const r = (await actions.addBundledAgent(actionEv(fields) as never)) as { status?: number };
      expect(r.status).toBe(400);
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns generic copy for an unknown bundle code and does not report success', async () => {
    mockRequest.mockRejectedValue({ response: { errors: [{ message: 'Imports are one level deep.', extensions: { code: 'IMPORT_DEPTH' } }] } });
    const { actions } = await importMod();
    const r = (await actions.addBundledAgent(actionEv({ agentId: 'agent-helper', position: '1' }) as never)) as {
      status?: number; data?: { bundleError?: string; bundleAdded?: boolean };
    };
    expect(r.status).toBe(500);
    expect(r.data?.bundleAdded).toBeUndefined();
    expect(r.data?.bundleError).toContain('Something went wrong on our side.');
  });
});

it('#1170 passes the URL continuation to the authorized reverse read and resolves system identity', async () => {
  const memory = { id: 'system', name: 'System', urn: 'hrn:mem:example.com:system' };
  routeMock({ agent: { data: { agent: { ...personalAgent, systemMemoryId: 'system' } } },
    extensions: { data: { agent: { extendedBy: { items: [], hasMore: true, endCursor: 'opaque-next' } } } }, systemIdentity: { data: { memory } } });
  const event = ev({ agentId: personalAgent.id }); event.url.searchParams.set('extendedAfter', 'opaque-after');
  const result = await (await importLoad())(event) as any;
  expect(mockRequest).toHaveBeenCalledWith(AGENT_EXTENSIONS_QUERY, { ref: personalAgent.id, after: 'opaque-after' });
  expect(mockRequest).toHaveBeenCalledWith(AGENT_SYSTEM_MEMORY_IDENTITY_QUERY, { ref: 'system' });
  expect(result.extendedBy).toMatchObject({ hasMore: true, items: [], endCursor: 'opaque-next', failed: false });
  expect(result.systemMemoryIdentity).toEqual(memory);
  expect(result.extendedAfter).toBe('opaque-after');
});
it('#1170 never starts reverse enumeration when the base Agent is unreadable', async () => {
  routeMock({ agent: { data: { agent: null } } });
  await expect((await importLoad())(ev())).rejects.toMatchObject({ status: 404 });
  expect(mockRequest).not.toHaveBeenCalledWith(AGENT_EXTENSIONS_QUERY, expect.anything());
});

it('#1261 returns the raw requested page even when the reverse read fails', async () => {
  routeMock({ agent: { data: { agent: personalAgent } }, extensions: { error: new Error('expired') } });
  const event = ev(); event.url.searchParams.set('extendedAfter', 'opaque+/=');
  const result = await (await importLoad())(event) as any;
  expect(result.extendedAfter).toBe('opaque+/=');
  expect(result.extendedBy.failed).toBe(true);
});

it.each(['SelfImportError', 'MultiLevelImportError', 'MissingGrantError', 'PositionConflictError'])(
  'preserves the landed publishAgentImport %s refusal', async (code) => {
    mockRequest.mockRejectedValue({ response: { errors: [{ message: 'Intentional bundle refusal.', extensions: { code } }] } });
    const { actions } = await importMod();
    const result = await actions.addBundledAgent(actionEv({ agentId: 'agent-helper', position: '1' }) as never);
    expect(result).toMatchObject({ status: 500, data: { bundleError: 'Intentional bundle refusal.' } });
  },
);
