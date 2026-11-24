/**
 * portal#2240 (ruling 0273): "When opening the page of an app in the portal, it
 * should not load more than it renders on the first screen it shows."
 *
 * Red-first acceptance: for every tab `resolveTabIntent` can return, plus the
 * default (no `?tab=`, which opens Chats), the server load issues exactly the
 * frame's operations and that tab's operations, nothing else. On main every
 * open ran every tab's reads (~20 operations) whatever was shown.
 *
 * The stubbed client dispatches on the operation name and REFUSES an operation
 * it has no row for, so a read added to the page later fails here by name
 * instead of slipping onto the first screen unnoticed (the same discipline as
 * roster-critical-path.test.ts, #2238).
 *
 * The expected sets below are the tab -> reads table the PR body carries. They
 * come from what each tab's markup reads (`+page.svelte`), not from what the
 * loader happened to fetch: a read belongs to a tab when that tab renders it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_TAB_IDS } from './tab-intent';

const h = vi.hoisted(() => {
  const ops: string[] = [];
  const opts = { orgApp: false, liveWorkerStop: false };
  const operationOf = (document: string) => /\b(?:query|mutation)\s+([A-Za-z]\w*)/.exec(document)?.[1] ?? '(anonymous)';
  const emptyPage = { items: [], total: 0, hasMore: false };
  const appRow = () => ({
    id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION',
    role: 'OWNER', description: '', createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
    sessionTimeoutSeconds: 3600, anonymousTtlDays: 30,
    organizationId: opts.orgApp ? 'o1' : null,
    // An agent is linked, so the chat AI-config reads are in play: they are
    // the ones most likely to leak onto another tab's open.
    agentId: 'ag1', agents: [], members: [], surfaces: [], installedAgentUrn: null,
    availableMemberRoles: ['MEMBER'], agentTools: [],
  });
  const signals = () => (opts.liveWorkerStop
    ? [{ id: 's1', level: 'STOP', scope: 'WORKER', targetWorkerId: 'w1', targetHostId: null, setAt: '2026-11-18T00:00:00Z', until: null,
        setByUserId: 'u1', setByHostKey: null, live: true, endedAt: null, endKind: null, endedByUserId: null, endedByHostKey: null }]
    : []);
  const rows: Record<string, () => unknown> = {
    App: () => ({ app: appRow() }),
    AppDetailOrg: () => ({ organization: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com', members: [] } }),
    AiServiceConfigs: () => ({ aiServiceConfigs: emptyPage }),
    AppMembers: () => ({ app: { members: [] } }),
    MyAgents: () => ({ agents: emptyPage }),
    PublicAgents: () => ({ publicAgents: emptyPage }),
    MemberOrgIds: () => ({ organizations: { items: [], total: 0 } }),
    AppOrgAgents: () => ({ organization: { agents: [] } }),
    AppOrgAgentGrants: () => ({ organization: { agentOrgGrants: [] } }),
    ChatAiConfigChoices: () => ({ chatAiConfigChoices: [] }),
    ResolveAiServiceConfigs: () => ({ resolveAiServiceConfigs: [] }),
    AppChatbotAiConfig: () => ({ app: { chatbotAiConfigId: null } }),
    AppSaturationAlarmWakeRoles: () => ({ saturationAlarmWakeRoles: { appId: 'a1', roles: [] } }),
    AppNodesPage: () => ({ appNodesPage: emptyPage }),
    Workers: () => ({ workers: { items: [{ id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null }], total: 1 } }),
    TeamChatMessages: () => ({ teamChatMessages: { items: [], total: 0 } }),
    TeamWorkItems: () => ({ teamWorkItems: { items: [], total: 0 } }),
    AppChatRootsPage: () => ({ appNodesPage: emptyPage }),
    SelfCanManage: () => ({ effectiveAccess: { canManage: true } }),
    AppChannels: () => ({ channels: { items: [], total: 0 } }),
    AppKeyScopes: () => ({ appKeysPage: emptyPage }),
    AppKeys: () => ({ appKeysPage: emptyPage }),
    AppViewerManages: () => ({ app: { id: 'a1', viewerManages: true } }),
    AppTeamRoster: () => ({ teamRoster: { workers: [] } }),
    AppBootPointers: () => ({ app: { appAgents: [] } }),
    AppInstallMarks: () => ({ app: { appAgents: [] } }),
    TeamStopSignals: () => ({ teamStopSignals: { signals: signals(), pageInfo: { hasNextPage: false, endCursor: null } } }),
    AppMemoryScope: () => ({ appMemoryScope: { items: [], total: 0 } }),
    AppMemories: () => ({ memories: { items: [], total: 0 } }),
    // Runs (already tab-gated before #2240; kept as it was).
    AppRuns: () => ({ appRuns: { items: [], total: 0 } }),
    AppInstalledAgents: () => ({ app: { appAgents: [] } }),
    AppNodes: () => ({ appNodes: [] }),
    AppFlowsPage: () => ({ appNodesPage: emptyPage }),
    AgentTasksApp: () => ({ app: { id: 'a1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null } }),
    // Node-role templates (already tab-gated before #2240; kept as it was).
    RoleTemplates: () => ({ memoryConfigTemplates: { total: 0, items: [] } }),
    ConfigMemoryChoices: () => ({ memories: { items: [], total: 0 } }),
  };
  return {
    ops,
    opts,
    respond(document: string): Promise<unknown> {
      const op = operationOf(document);
      ops.push(op);
      const row = rows[op];
      if (!row) throw new Error(`stub client: no dispatch row for operation "${op}" — the App page load grew a query; add a row and place it in the tab table`);
      return Promise.resolve(row());
    },
  };
});

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (document: string) => h.respond(document) }),
}));

beforeEach(() => {
  h.ops.length = 0;
  h.opts.orgApp = false;
  h.opts.liveWorkerStop = false;
});

async function loadPage(search: string) {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'a1' },
    locals: { token: 'tok', user: { id: 'u1' } },
    url: new URL(`http://localhost/app/apps/a1${search}`),
    setHeaders: () => {},
  } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
}

/** What the header and frame render on every tab: the App itself, the stop
 *  banner, and the Grants link (viewerManages). Worker names join the frame
 *  only when a live stop names a worker (below). */
const FRAME = ['App', 'AppViewerManages', 'TeamStopSignals'];

/** Each tab's own reads, from what its panel renders. */
const TAB_OPS: Record<string, string[]> = {
  // portal#2241: the frame's App read, plus the manage gate on its Edit in Settings link.
  profile: ['SelfCanManage'],
  // Team chat, chat list, author chips (staff), AI-config picker, writable memories.
  chats: ['Workers', 'TeamChatMessages', 'AppChatRootsPage', 'AppChannels', 'ChatAiConfigChoices', 'ResolveAiServiceConfigs', 'AppMemoryScope'],
  worklog: ['TeamWorkItems'],
  runs: ['AppRuns', 'AgentTasksApp', 'AppInstalledAgents', 'AppNodes', 'AppFlowsPage'],
  // The roster read is #2238's and stays as it landed there.
  staff: ['Workers', 'AppTeamRoster', 'AppInstallMarks'],
  members: ['AppMembers'],
  agents: ['MyAgents', 'PublicAgents', 'MemberOrgIds', 'AppBootPointers', 'AppInstallMarks', 'SelfCanManage'],
  memory: ['AppNodesPage', 'AppMemoryScope', 'SelfCanManage'],
  keys: ['AppKeys', 'AppKeyScopes'],
  'ai-configs': ['AiServiceConfigs', 'SelfCanManage'],
  settings: ['Workers', 'AppChatbotAiConfig', 'AppSaturationAlarmWakeRoles', 'ChatAiConfigChoices', 'ResolveAiServiceConfigs', 'SelfCanManage', 'AppMemoryScope'],
  'node-role-templates': ['RoleTemplates', 'AppViewerManages', 'ConfigMemoryChoices'],
  client: ['SelfCanManage', 'AppKeys'],
};

const opSet = () => [...new Set(h.ops)].sort();
const expected = (tab: string) => [...new Set([...FRAME, ...TAB_OPS[tab]])].sort();
/** App Keys, AI Service Configs and Node-role templates are sections of Settings. A link that still says `?tab=keys` opens Settings with that
 *  section open, so its first screen is Settings' reads plus the section's own. */
const SECTION_TABS = ['keys', 'ai-configs', 'node-role-templates'];
const expectedOpening = (tab: string) => SECTION_TABS.includes(tab)
  ? [...new Set([...FRAME, ...TAB_OPS.settings, ...TAB_OPS[tab]])].sort()
  : expected(tab);

describe('App page loader: the first screen only (portal#2240)', () => {
  it('has a read table row for every tab id the page can open', () => {
    expect(Object.keys(TAB_OPS).sort()).toEqual([...APP_TAB_IDS].sort());
  });

  it.each(['worklog', 'staff', 'profile'])('?tab=%s still carries the frame clock (terminalNow): the display clock seeds from it on any first tab', async (tab) => {
    const payload = await loadPage(`?tab=${tab}`);
    expect(typeof payload.terminalNow).toBe('string');
    expect(Number.isNaN(Date.parse(payload.terminalNow as string))).toBe(false);
  });

  it('opens the default (no ?tab=) as Profile: frame + Profile reads only', async () => {
    await loadPage('');
    expect(opSet()).toEqual(expected('profile'));
  });

  it.each([...APP_TAB_IDS])('opening ?tab=%s issues the frame reads and that tab\'s reads only', async (tab) => {
    await loadPage(`?tab=${tab}`);
    expect(opSet()).toEqual(expectedOpening(tab));
  });

  it('opening Settings with no section named reads no section data: a folded section costs no read', async () => {
    await loadPage('?tab=settings');
    expect(opSet()).toEqual(expected('settings'));
    expect(opSet()).not.toContain('AppKeys');
    expect(opSet()).not.toContain('AiServiceConfigs');
  });

  it.each(SECTION_TABS)('?tab=settings&section=%s reads that section with Settings', async (section) => {
    await loadPage(`?tab=settings&section=${section}`);
    expect(opSet()).toEqual(expectedOpening(section));
  });

  it('an org-owned App adds the org to the frame, and its picker reads to Agents only', async () => {
    h.opts.orgApp = true;
    await loadPage('?tab=worklog');
    expect(opSet()).toEqual([...FRAME, 'AppDetailOrg', 'TeamWorkItems'].sort());
    h.ops.length = 0;
    await loadPage('?tab=agents');
    expect(opSet()).toEqual(
      [...FRAME, 'AppDetailOrg', 'AppOrgAgents', 'AppOrgAgentGrants', 'AppBootPointers', 'AppInstallMarks', 'SelfCanManage'].sort(),
    );
  });

  it('a live stop naming a worker brings the worker names into the frame, for the banner', async () => {
    h.opts.liveWorkerStop = true;
    await loadPage('?tab=worklog');
    expect(opSet()).toEqual([...FRAME, 'Workers', 'TeamWorkItems'].sort());
  });
});
