/**
 * #648 part 2 — /app/apps/new: the org-less (personal) app create/install flow.
 * The loader offers installable agents (own personal ∪ PUBLIC) + preselects
 * ?agent=; the action installs via createApp (no orgId) and redirects to the
 * canonical detail.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  MY_APPS_QUERY,
  CREATE_PERSONAL_APP_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

const mockFetchAll = vi.fn();
vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: (_client: unknown, doc: string, ...rest: unknown[]) => mockFetchAll(doc, ...rest),
  PAGE_LIMIT: 200,
}));

type Agent = { id: string; urn: string; name: string; description?: string | null; organizationId?: string | null };

function routeFetch(opts: { mine?: Agent[]; pub?: Agent[]; apps?: unknown[] } = {}) {
  mockFetchAll.mockImplementation(async (doc: string) => {
    if (doc === MY_AGENTS_QUERY) return opts.mine ?? [];
    if (doc === PUBLIC_AGENTS_QUERY) return opts.pub ?? [];
    if (doc === MY_APPS_QUERY) return opts.apps ?? [];
    return [];
  });
}

async function importMod() {
  return await import('./+page.server');
}

function loadEv(search = '', user: { handle: string | null } | null = { handle: 'holger' }) {
  return {
    locals: { token: 't' },
    url: new URL(`http://x/app/apps/new${search}`),
    parent: async () => ({ user }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set('_kind', 'createPersonalApp');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    locals: { token: 't' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['default']>[0];
}

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAll.mockReset();
});

const OWN: Agent = { id: 'a-own', urn: 'holger:my-agent', name: 'My Agent', organizationId: null };
const PUB: Agent = { id: 'a-pub', urn: 'hadronmemory.com:gmail-agent', name: 'Gmail Agent' };

describe('/app/apps/new loader', () => {
  it('offers own personal ∪ public agents and seeds defaults from the first', async () => {
    routeFetch({ mine: [OWN], pub: [PUB], apps: [] });
    const { load } = await importMod();
    const res = (await load(loadEv())) as {
      agents: Agent[];
      handle: string | null;
      form: { data: { agentId: string; name: string; urn: string } };
    };
    expect(res.agents.map((a) => a.id)).toEqual(['a-own', 'a-pub']);
    expect(res.handle).toBe('holger');
    expect(res.form.data.agentId).toBe('a-own');
    expect(res.form.data.name).toBe('My Agent');
    expect(res.form.data.urn).toBe('my-agent');
  });

  it('preselects ?agent=<id> when installable', async () => {
    routeFetch({ mine: [OWN], pub: [PUB], apps: [] });
    const { load } = await importMod();
    const res = (await load(loadEv('?agent=a-pub'))) as { form: { data: { agentId: string } } };
    expect(res.form.data.agentId).toBe('a-pub');
  });

  it('surfaces a null handle (handle-less account cannot create)', async () => {
    routeFetch({ mine: [OWN], pub: [] });
    const { load } = await importMod();
    const res = (await load(loadEv('', { handle: null }))) as { handle: string | null };
    expect(res.handle).toBeNull();
  });

  it('surfaces a lookup failure as loadFailed (not a false "no agents")', async () => {
    mockFetchAll.mockImplementation(async (doc: string) => {
      if (doc === MY_AGENTS_QUERY || doc === PUBLIC_AGENTS_QUERY) throw new Error('boom');
      return [];
    });
    const { load } = await importMod();
    const res = (await load(loadEv())) as { loadFailed: boolean; agents: unknown[] };
    expect(res.loadFailed).toBe(true);
    expect(res.agents).toEqual([]);
  });
});

describe('/app/apps/new default action', () => {
  it('installs via createApp (no orgId) and redirects to the canonical detail', async () => {
    routeFetch({ mine: [OWN], pub: [PUB] });
    mockRequest.mockResolvedValueOnce({ createApp: { id: 'app-new' } });
    const { actions } = await importMod();
    await expect(
      actions.default(actionEv({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION' })),
    ).rejects.toMatchObject({ status: 303, location: '/app/apps/app-new' });
    // createApp called WITHOUT orgId (personal create).
    const [doc, vars] = mockRequest.mock.calls[0];
    expect(doc).toBe(CREATE_PERSONAL_APP_MUTATION);
    expect(vars).toMatchObject({ agentRef: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION', surfaces: ['mcp'] });
    expect(vars).not.toHaveProperty('orgRef');
  });

  it('rejects an agent that is neither the caller’s own nor PUBLIC', async () => {
    routeFetch({ mine: [OWN], pub: [PUB] });
    const { actions } = await importMod();
    const result = (await actions.default(
      actionEv({ agentId: 'a-foreign', name: 'X', urn: 'x', appType: 'WORKSTATION' }),
    )) as { status: number; data: { form: { errors: { agentId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('defers to the server gate (no pre-reject) when the installable lookup fails', async () => {
    // Both agent lookups fail → the list is unreliable → don't reject a
    // possibly-valid agent; let createApp be authoritative.
    mockFetchAll.mockImplementation(async (doc: string) => {
      if (doc === MY_AGENTS_QUERY || doc === PUBLIC_AGENTS_QUERY) throw new Error('boom');
      return [];
    });
    mockRequest.mockResolvedValueOnce({ createApp: { id: 'app-x' } });
    const { actions } = await importMod();
    await expect(
      actions.default(actionEv({ agentId: 'a-own', name: 'X', urn: 'x', appType: 'WORKSTATION' })),
    ).rejects.toMatchObject({ status: 303, location: '/app/apps/app-x' });
    expect(mockRequest).toHaveBeenCalled();
  });

  it('maps a URN collision to a field error', async () => {
    routeFetch({ mine: [OWN], pub: [PUB] });
    mockRequest.mockRejectedValueOnce(new Error('An app with URN "holger:my-app" already exists'));
    const { actions } = await importMod();
    const result = (await actions.default(
      actionEv({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION' }),
    )) as { status: number; data: { form: { errors: { urn?: string[] } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.errors.urn).toBeDefined();
  });
});


it.each(['BAD_USER_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'AGENT_NOT_FOUND', 'ORGANIZATION_MISMATCH', 'INSTALL_MEMORIES_REMAIN'])(
  'keeps createApp %s as an intentional 400 refusal', async (code) => {
    routeFetch({ mine: [OWN] });
    mockRequest.mockRejectedValue({ response: { errors: [{ message: 'Intentional create refusal.', extensions: { code } }] } });
    const { actions } = await importMod();
    const result = await actions.default(actionEv({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION' }));
    expect(result).toMatchObject({ status: 400 });
    expect(JSON.stringify(result)).toContain('Intentional create refusal.');
  },
);

it.each(['INTERNAL_SERVER_ERROR', 'FUTURE_UNKNOWN_CODE'])(
  'keeps createApp %s generic and distinct from a client refusal', async (code) => {
    routeFetch({ mine: [OWN] });
    mockRequest.mockRejectedValue({ response: { errors: [{ message: 'private diagnostics', extensions: { code } }] } });
    const { actions } = await importMod();
    const result = await actions.default(actionEv({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION' }));
    expect(result).toMatchObject({ status: 500 });
    expect(JSON.stringify(result)).not.toContain('private diagnostics');
  },
);

// ---------------------------------------------------------------------------
// #1786 (hadron-server#3626, ruling 0235): a member may install an
// ORGANIZATION-visible Agent of their organization into a personal App.
// The documents are matched by content, not by name, so these pins are red on
// a main that has neither document rather than failing at import.
// ---------------------------------------------------------------------------
const ORG = { id: 'a-org', urn: 'hrn:agent:acme.com:org-agent', name: 'Org Agent', description: null, organizationId: 'org-1' };
const isMemberOrgsDoc = (doc: string) => /organizations\s*\(\s*filter:\s*\{\s*memberOnly:\s*true\s*\}/.test(doc);
const isOrgAgentsDoc = (doc: string) => /agents\s*\(\s*filter:\s*\{\s*visibility:\s*ORGANIZATION\s*\}/.test(doc);

function routeOrgFetch(opts: {
  mine?: Agent[]; pub?: Agent[]; orgs?: string[] | Error; orgAgents?: Record<string, Agent[] | Error>;
} = {}) {
  mockFetchAll.mockImplementation(async (doc: string, _field: string, vars?: { orgRef?: string }) => {
    if (doc === MY_AGENTS_QUERY) return opts.mine ?? [];
    if (doc === PUBLIC_AGENTS_QUERY) return opts.pub ?? [];
    if (doc === MY_APPS_QUERY) return [];
    if (isMemberOrgsDoc(doc)) {
      if (opts.orgs instanceof Error) throw opts.orgs;
      return (opts.orgs ?? []).map((id) => ({ id }));
    }
    if (isOrgAgentsDoc(doc)) {
      const hit = opts.orgAgents?.[vars?.orgRef ?? ''];
      if (hit instanceof Error) throw hit;
      return hit ?? [];
    }
    return [];
  });
}

const orgAgentCalls = () => mockFetchAll.mock.calls.filter(([doc]) => isOrgAgentsDoc(doc as string));

describe('#1786 organization Agents on /app/apps/new', () => {
  beforeEach(() => { mockFetchAll.mockReset(); mockRequest.mockReset(); });

  it('a member is offered their organization’s ORGANIZATION-visible Agent, after mine and public', async () => {
    routeOrgFetch({ mine: [OWN], pub: [PUB], orgs: ['org-1'], orgAgents: { 'org-1': [ORG] } });
    const { load } = await importMod();
    const res = (await load(loadEv())) as { agents: Agent[]; loadFailed: boolean; form: { data: { agentId: string } } };
    expect(res.agents.map((a) => a.id)).toEqual(['a-own', 'a-pub', 'a-org']);
    expect(res.loadFailed).toBe(false);
    expect(res.form.data.agentId).toBe('a-own');
  });

  it('a member’s POST naming the org Agent passes the pre-check and reaches createApp', async () => {
    routeOrgFetch({ mine: [OWN], orgs: ['org-1'], orgAgents: { 'org-1': [ORG] } });
    mockRequest.mockResolvedValueOnce({ createApp: { id: 'app-org' } });
    const { actions } = await importMod();
    await expect(
      actions.default(actionEv({ agentId: 'a-org', name: 'Org App', urn: 'org-app', appType: 'WORKSTATION' })),
    ).rejects.toMatchObject({ status: 303, location: '/app/apps/app-org' });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ agentRef: 'a-org' });
  });

  it('a non-member (no member orgs) is not offered it, no org-Agent list is asked for, and a POST gets the local 400', async () => {
    routeOrgFetch({ mine: [OWN], pub: [PUB], orgs: [], orgAgents: { 'org-1': [ORG] } });
    const { load, actions } = await importMod();
    const res = (await load(loadEv())) as { agents: Agent[] };
    expect(res.agents.map((a) => a.id)).toEqual(['a-own', 'a-pub']);
    const result = (await actions.default(
      actionEv({ agentId: 'a-org', name: 'X', urn: 'x', appType: 'WORKSTATION' }),
    )) as { status: number; data: { form: { errors: { agentId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(orgAgentCalls()).toHaveLength(0);
    // The membership list really was consulted (not skipped).
    expect(mockFetchAll.mock.calls.some(([doc]) => isMemberOrgsDoc(doc as string))).toBe(true);
  });

  it('asks for org Agents once per member org, always with that org’s orgId (never an unscoped admin list)', async () => {
    routeOrgFetch({ orgs: ['org-1', 'org-2'], orgAgents: { 'org-1': [ORG], 'org-2': [] } });
    const { load } = await importMod();
    await load(loadEv());
    const calls = orgAgentCalls();
    expect(calls.map(([, , vars]) => (vars as { orgRef?: string } | undefined)?.orgRef).sort()).toEqual(['org-1', 'org-2']);
  });

  it('dedupes an Agent found in two lists or two orgs; first source wins', async () => {
    const pubAlsoOrg = { ...ORG, id: 'a-pub' };
    routeOrgFetch({
      mine: [OWN], pub: [PUB], orgs: ['org-1', 'org-2'],
      orgAgents: { 'org-1': [pubAlsoOrg, ORG], 'org-2': [ORG] },
    });
    const { load } = await importMod();
    const res = (await load(loadEv())) as { agents: Agent[] };
    expect(res.agents.map((a) => a.id)).toEqual(['a-own', 'a-pub', 'a-org']);
    expect(res.agents[1].name).toBe(PUB.name);
  });

  it.each([
    ['the member-org lookup', { orgs: new Error('boom') }],
    ['an org-Agent lookup', { orgs: ['org-1'], orgAgents: { 'org-1': new Error('boom') } }],
  ] as const)('a failed %s shows loadFailed on GET and defers to the server on POST', async (_what, failing) => {
    routeOrgFetch({ mine: [OWN], pub: [PUB], ...failing } as Parameters<typeof routeOrgFetch>[0]);
    const { load, actions } = await importMod();
    const res = (await load(loadEv())) as { loadFailed: boolean; agents: Agent[] };
    expect(res.loadFailed).toBe(true);
    expect(res.agents.map((a) => a.id)).toEqual(['a-own', 'a-pub']);
    mockRequest.mockResolvedValueOnce({ createApp: { id: 'app-z' } });
    await expect(
      actions.default(actionEv({ agentId: 'a-org', name: 'Z', urn: 'z', appType: 'WORKSTATION' })),
    ).rejects.toMatchObject({ status: 303, location: '/app/apps/app-z' });
  });

  it.each(['AGENT_NOT_FOUND', 'ORGANIZATION_MISMATCH', 'BAD_USER_INPUT'])(
    'an ex-member whose list still shows the Agent gets createApp %s as a 400 with the server’s text, not a 500',
    async (code) => {
      routeOrgFetch({ orgs: ['org-1'], orgAgents: { 'org-1': [ORG] } });
      mockRequest.mockRejectedValue({ response: { errors: [{ message: `Refused: ${code}.`, extensions: { code } }] } });
      const { actions } = await importMod();
      const result = await actions.default(actionEv({ agentId: 'a-org', name: 'O', urn: 'o', appType: 'WORKSTATION' }));
      expect(result).toMatchObject({ status: 400 });
      expect(JSON.stringify(result)).toContain(`Refused: ${code}.`);
    },
  );
});

describe('limit refusal (#2569, door 6)', () => {
  it('personal App create: 409 with the server text, not 400/500 (C3-R2)', async () => {
    routeFetch({ mine: [OWN], pub: [PUB] });
    mockRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'Your account has reached its limit of 3 Apps.', extensions: { code: 'OWNER_LIMIT_REACHED', limitKey: 'apps', ownerType: 'user', callerCanManageOwner: true, ownerId: 'u1', limit: '3' } }] } });
    const { actions } = await importMod();
    const result = (await actions.default(actionEv({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION' }))) as { status: number; data: { form: { message?: { text: string } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('Your account has reached its limit of 3 Apps.');
  });
});
