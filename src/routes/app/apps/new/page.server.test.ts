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
    expect(vars).toMatchObject({ agentId: 'a-own', name: 'My App', urn: 'my-app', appType: 'WORKSTATION', surfaces: ['mcp'] });
    expect(vars).not.toHaveProperty('orgId');
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
