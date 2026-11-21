/**
 * portal#2238 — the roster must not be on the App page's critical path.
 *
 * Red-first acceptance (the issue's gated body): opening the App on any tab
 * other than `staff` (the default included) issues NO APP_TEAM_ROSTER_QUERY,
 * and `data.teamRoster` is null ("not loaded"). With `?tab=staff` the roster
 * is requested exactly once, bounded by OPTIONAL_LIST_TIMEOUT_MS: a roster
 * that never answers lets the load finish at the bound with
 * `teamRoster { kind: 'failed' }` — on main it hangs the load for as long as
 * the server takes, which in prod was 61 s and a 1.5-minute page.
 *
 * This is the loader-level test the gate requires: a stubbed GraphQL client
 * that dispatches on the query document, not a mounted page. tab-intent.ts's
 * header calls mocking this ~19-query load impractical; the dispatch table
 * below is the practical version — every operation the load fires has a row,
 * and one without fails the test naming the operation, so the table cannot
 * silently rot as queries are added to the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_TEAM_ROSTER_QUERY } from '$lib/server/queries';
import type { TeamRosterRead } from '$lib/server/app-team-roster';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { ROSTER_FETCH_TIMEOUT_MS } from '$lib/roster-fetch';

const h = vi.hoisted(() => {
  /** Every request the stubbed client received, in order. */
  const requests: { document: string; variables: Record<string, unknown> }[] = [];
  /** What the stubbed teamRoster resolver does: answer, hang, or fail. */
  const roster: { mode: 'ok' | 'hang' | 'throw' } = { mode: 'ok' };
  const operationOf = (document: string) => /\bquery\s+([A-Za-z]\w*)/.exec(document)?.[1] ?? '(anonymous)';
  // An org-less, agent-less App: the smallest branch through the load. The
  // roster is the only read this file asserts on; the rest just have to
  // answer so the load reaches its return.
  const appRow = {
    id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION',
    role: 'OWNER', description: '', createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
    sessionTimeoutSeconds: 3600, organizationId: null, agentId: null, agents: [], members: [],
    surfaces: [], installedAgentUrn: null,
  };
  const emptyPage = { items: [], total: 0, hasMore: false };
  const responses: Record<string, unknown> = {
    App: { app: appRow },
    AiServiceConfigs: { aiServiceConfigs: emptyPage },
    AppMembers: { app: { members: [] } },
    MyAgents: { agents: emptyPage },
    PublicAgents: { publicAgents: emptyPage },
    MemberOrgIds: { organizations: { items: [], total: 0 } },
    AppChatbotAiConfig: { app: { chatbotAiConfigId: null } },
    AppNodesPage: { appNodesPage: emptyPage },
    Workers: { workers: { items: [], total: 0 } },
    TeamChatMessages: { teamChatMessages: { items: [], total: 0 } },
    TeamWorkItems: { teamWorkItems: { items: [], total: 0 } },
    AppChatRootsPage: { appNodesPage: emptyPage },
    SelfCanManage: { effectiveAccess: { canManage: true } },
    AppChannels: { channels: { items: [], total: 0 } },
    AppKeyScopes: { appKeysPage: emptyPage },
    AppKeys: { appKeysPage: emptyPage },
    AppViewerManages: { app: { viewerManages: true } },
    AppBootPointers: { app: { appAgents: [] } },
    AppInstallMarks: { app: { appAgents: [] } },
    TeamStopSignals: { teamStopSignals: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    AppMemoryScope: { appMemoryScope: { items: [], total: 0 } },
  };
  return {
    requests,
    roster,
    respond(document: string): Promise<unknown> {
      const op = operationOf(document);
      if (op === 'AppTeamRoster') {
        if (roster.mode === 'hang') return new Promise<never>(() => {});
        if (roster.mode === 'throw') return Promise.reject(new Error('INTERNAL_SERVER_ERROR'));
        return Promise.resolve({
          teamRoster: {
            workers: [
              {
                worker: { id: 'w1' }, checkStatus: { status: 'OK', pendingReason: null },
                pausedUntil: null, currentTask: null, heldBy: null, heldAt: null, terminal: null,
              },
            ],
          },
        });
      }
      const row = responses[op];
      if (row === undefined) {
        throw new Error(
          `stub client: no dispatch row for operation "${op}" — the App page load grew a query; add a row`,
        );
      }
      return Promise.resolve(row);
    },
  };
});

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: (document: string, variables: Record<string, unknown> = {}) => {
      h.requests.push({ document, variables });
      return h.respond(document);
    },
  }),
}));

beforeEach(() => {
  h.requests.length = 0;
  h.roster.mode = 'ok';
});
afterEach(() => vi.useRealTimers());

const rosterRequests = () => h.requests.filter((r) => r.document === APP_TEAM_ROSTER_QUERY);

async function loadPage(search: string): Promise<{ teamRoster: TeamRosterRead | null }> {
  const { load } = await import('./+page.server');
  // The load's Kit-inferred return union includes `void` for the 404 path;
  // this test only drives the success path, so narrow to the data shape.
  return (await load({
    params: { appId: 'a1' },
    locals: { token: 'tok', user: { id: 'u1' } },
    url: new URL(`http://localhost/app/apps/a1${search}`),
    setHeaders: () => {},
  } as unknown as Parameters<typeof load>[0])) as { teamRoster: TeamRosterRead | null };
}

describe('App page loader: the roster is off the critical path (portal#2238)', () => {
  // The default tab and three others, one per tab family the page has. On
  // main every one of these opens fires APP_TEAM_ROSTER_QUERY inside the
  // page's Promise.all — these are the red lines.
  it.each(['', '?tab=chats', '?tab=worklog', '?tab=settings'])(
    'opening on %j issues no APP_TEAM_ROSTER_QUERY and loads no roster',
    async (search) => {
      const data = await loadPage(search);
      expect(rosterRequests()).toHaveLength(0);
      expect(data.teamRoster).toBeNull();
    },
  );

  it('opens ?tab=staff with exactly one roster read, joined by worker id', async () => {
    const data = await loadPage('?tab=staff');
    expect(rosterRequests()).toHaveLength(1);
    expect(rosterRequests()[0]?.variables).toMatchObject({ appRef: 'a1' });
    expect(data.teamRoster).toEqual({
      kind: 'ok',
      byWorker: {
        w1: expect.objectContaining({ worker: { id: 'w1' }, currentTask: null }),
      },
    });
  });

  it('a roster that never answers still lets the ?tab=staff load finish at the 8 s bound, as failed', async () => {
    vi.useFakeTimers();
    h.roster.mode = 'hang';
    const pending = loadPage('?tab=staff');
    // One millisecond inside the bound the load is still waiting — the bound
    // is what releases the page, not the server answering.
    await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS - 1);
    expect(await Promise.race([pending.then(() => true), Promise.resolve(false)])).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const data = await pending;
    expect(data.teamRoster).toEqual({ kind: 'failed' });
  });

  it('the client transport bound sits above the endpoint bound, with room for the network and the JSON (portal#2282, #2310)', () => {
    // A client that gives up first discards an answer the server is still entitled to send.
    // The margin is pinned here (a node test may import server modules); the client test imports none.
    expect(ROSTER_FETCH_TIMEOUT_MS - OPTIONAL_LIST_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
  });

  it('a roster that errors maps to failed, not a thrown load (the existing contract, kept)', async () => {
    h.roster.mode = 'throw';
    const data = await loadPage('?tab=staff');
    expect(data.teamRoster).toEqual({ kind: 'failed' });
  });
});
