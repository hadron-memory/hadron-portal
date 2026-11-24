/**
 * portal#2240 — the endpoint a tab's first show fetches (ruling 0273).
 *
 * - It reads that tab's groups and nothing of the frame: the App read (the
 *   access gate every tab needs) plus the tab's own operations.
 * - Its payload is the page load's own for the same URL, restricted to the
 *   tab's keys, so a tab renders the same data however it arrived.
 * - The roster is never in it: after a switch, #2238's roster endpoint owns it.
 * - Without a session it refuses with 401; an unknown tab is a 400; an App the
 *   caller may not open answers the status and `{ kind: 'failed' }`, no server text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { READ_GROUP_KEYS, TAB_READS } from '../first-screen';

const h = vi.hoisted(() => {
  const ops: string[] = [];
  const opts = { app: 'ok' as 'ok' | 'refused', orgApp: false };
  const operationOf = (document: string) => /\b(?:query|mutation)\s+([A-Za-z]\w*)/.exec(document)?.[1] ?? '(anonymous)';
  const emptyPage = { items: [], total: 0, hasMore: false };
  const rows: Record<string, () => unknown> = {
    App: () => ({
      app: {
        id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION', role: 'OWNER', description: '',
        createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 30,
        organizationId: opts.orgApp ? 'o1' : null, agentId: 'ag1', agents: [], members: [], surfaces: [],
        installedAgentUrn: null, availableMemberRoles: ['MEMBER'], agentTools: [],
      },
    }),
    AppDetailOrg: () => ({ organization: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com', members: [] } }),
    AppMemories: () => ({ memories: { items: [], total: 0 } }),
    TeamWorkItems: () => ({ teamWorkItems: { items: [{ id: 'wi1' }], total: 1 } }),
    AppKeys: () => ({ appKeysPage: { items: [{ id: 'k1' }], total: 1, hasMore: false } }),
    AppKeyScopes: () => ({ appKeysPage: emptyPage }),
    Workers: () => ({ workers: { items: [{ id: 'w1', name: 'Ada', urn: null, retiredAt: null }], total: 1 } }),
    AppInstallMarks: () => ({ app: { appAgents: [] } }),
    AppNodesPage: () => ({ appNodesPage: emptyPage }),
    AppMemoryScope: () => ({ appMemoryScope: { items: [], total: 0 } }),
    SelfCanManage: () => ({ effectiveAccess: { canManage: true } }),
    // The frame's, present so the page-load comparison below can run.
    AppViewerManages: () => ({ app: { id: 'a1', viewerManages: true } }),
    TeamStopSignals: () => ({ teamStopSignals: { signals: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    AppTeamRoster: () => ({ teamRoster: { workers: [] } }),
    // Settings' reads: a `?tab=keys` page load now opens Settings with the App Keys section, so the comparison below makes them too.
    ChatAiConfigChoices: () => ({ chatAiConfigChoices: [] }),
    ResolveAiServiceConfigs: () => ({ resolveAiServiceConfigs: [] }),
    AppChatbotAiConfig: () => ({ app: { chatbotAiConfigId: null } }),
    AppSaturationAlarmWakeRoles: () => ({ saturationAlarmWakeRoles: { appId: 'a1', roles: [] } }),
  };
  return {
    ops,
    opts,
    respond(document: string): Promise<unknown> {
      const op = operationOf(document);
      ops.push(op);
      if (op === 'App' && opts.app === 'refused') {
        return Promise.reject(Object.assign(new Error('production text'), {
          response: { data: { app: null }, errors: [{ message: 'production text', extensions: { code: 'APP_NOT_FOUND' } }] },
        }));
      }
      const row = rows[op];
      if (!row) throw new Error(`stub client: no dispatch row for operation "${op}"`);
      return Promise.resolve(row());
    },
  };
});

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (document: string) => h.respond(document) }),
}));

beforeEach(() => {
  h.ops.length = 0;
  h.opts.app = 'ok';
  h.opts.orgApp = false;
});

const SIGNED_IN = { token: 'tok', user: { id: 'u1' } };

async function get(search: string, locals: Record<string, unknown> = SIGNED_IN) {
  const { GET } = await import('./+server');
  try {
    const res = (await GET({
      params: { appId: 'a1' },
      locals,
      url: new URL(`http://localhost/app/apps/a1/tab${search}`),
    } as unknown as Parameters<typeof GET>[0])) as Response;
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? -1, body: {}, headers: new Headers() };
  }
}

const keysOf = (tab: keyof typeof TAB_READS) =>
  TAB_READS[tab].flatMap((g) => [...READ_GROUP_KEYS[g]]).sort();

describe('GET /app/apps/[appId]/tab (portal#2240)', () => {
  it('reads the App and that tab only: no frame reads', async () => {
    const r = await get('?tab=worklog');
    expect(r.status).toBe(200);
    expect([...new Set(h.ops)].sort()).toEqual(['App', 'TeamWorkItems']);
    expect(Object.keys(r.body).sort()).toEqual(keysOf('worklog'));
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers the page load\'s own payload for that tab\'s keys', async () => {
    const r = await get('?tab=keys');
    const { load } = await import('../+page.server');
    const page = (await load({
      params: { appId: 'a1' }, locals: SIGNED_IN, url: new URL('http://localhost/app/apps/a1?tab=keys'), setHeaders: () => {},
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
    for (const key of keysOf('keys')) expect(r.body[key]).toEqual(JSON.parse(JSON.stringify(page[key])));
  });

  it('never asks for the roster: after a switch #2238\'s first-show fetch owns it', async () => {
    const r = await get('?tab=staff');
    expect(h.ops).not.toContain('AppTeamRoster');
    expect(r.body).not.toHaveProperty('teamRoster');
    expect(r.body.staff).toEqual([expect.objectContaining({ id: 'w1' })]);
  });

  it('reads an org App\'s org for the Memory tab\'s create offer', async () => {
    h.opts.orgApp = true;
    const r = await get('?tab=memory');
    expect(h.ops).toContain('AppDetailOrg');
    expect(r.body).toHaveProperty('canCreateMemory');
  });

  it.each(['', '?tab=', '?tab=nonsense', '?tab=constructor'])('refuses %j as a 400 with no read', async (search) => {
    const r = await get(search);
    expect(r.status).toBe(400);
    expect(h.ops).toEqual([]);
  });

  it('refuses a caller without a session with 401 and no read', async () => {
    const r = await get('?tab=worklog', {});
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ kind: 'failed' });
    expect(h.ops).toEqual([]);
  });

  it('an App the caller may not open answers 404 and failed, with no server text', async () => {
    h.opts.app = 'refused';
    const r = await get('?tab=worklog');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ kind: 'failed' });
    expect(JSON.stringify(r.body)).not.toContain('production text');
  });
});
