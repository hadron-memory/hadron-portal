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
  const docs: Record<string, string> = {};
  const opts = { orgApp: false, liveWorkerStop: false, membersFail: false };
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
    AppOrgMembers: () => {
      if (opts.membersFail) throw Object.assign(new Error('boom'), { response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
      return { organization: { id: 'o1', members: [{ id: 'm1', role: 'ADMIN', user: { id: 'u1' } }] } };
    },
    AppDetailOrg: () => ({ organization: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com' } }),
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
    AppAttachedMemories: () => ({ app: { attachedMemories: [] } }),
    AppUserMemoryClasses: () => ({ app: { viewerAppUserMemoryClasses: [] } }),
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
    // Secrets (a section of Settings, read when it is asked for): the list and the signing probe.
    AppSecrets: () => ({ secrets: { total: 0, items: [] } }),
    SecretChangeRequestState: () => ({ secretChangeRequest: null }),
    // Tickers (a section of Settings, read when it is asked for): the list, the ticker settings and the delivery settings.
    AppTickers: () => ({ tickers: [] }),
    AppTickerSettings: () => ({ appTickerSettings: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 500, dailyWakeBudgetDerived: true } }),
    AppDeliverySettings: () => ({ appDeliverySettings: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } }),
    // Stops (a section of Settings, read when it is asked for): the signals page, the roster and the people who set stops.
    StopWorkers: () => ({ teamRoster: { workers: [] } }),
    StopPeople: () => ({ app: { members: [] } }),
    // Channels (a section of Settings, read when it is asked for): the list, the register and the viewer's manage audit.
    // No shared memory, so no per-memory write audit is read.
    AppChannelsApp: () => ({ app: { id: 'a1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null, defaultChannel: null, sharedMemory: null } }),
    RegisterEntriesByOwner: () => ({ registerEntries: { items: [], total: 0 } }),
  };
  return {
    ops,
    docs,
    opts,
    respond(document: string): Promise<unknown> {
      const op = operationOf(document);
      ops.push(op);
      docs[op] = document;
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
  h.opts.membersFail = false;
});

async function loadPage(search: string) {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'a1' },
    locals: { token: 'tok', user: { id: 'u1' } },
    url: new URL(`http://localhost/app/apps/a1${search}`),
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
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
  chats: ['Workers', 'TeamChatMessages', 'AppChatRootsPage', 'AppChannels', 'ChatAiConfigChoices', 'ResolveAiServiceConfigs', 'AppMemoryScope', 'AppAttachedMemories'],
  worklog: ['TeamWorkItems'],
  runs: ['AppRuns', 'AgentTasksApp', 'AppInstalledAgents', 'AppNodes', 'AppFlowsPage'],
  // The roster read is #2238's and stays as it landed there.
  staff: ['Workers', 'AppTeamRoster', 'AppInstallMarks'],
  members: ['AppMembers'],
  agents: ['MyAgents', 'PublicAgents', 'MemberOrgIds', 'AppBootPointers', 'AppInstallMarks', 'SelfCanManage'],
  memory: ['AppNodesPage', 'AppMemoryScope', 'AppAttachedMemories', 'AppUserMemoryClasses', 'SelfCanManage'],
  keys: ['AppKeys', 'AppKeyScopes'],
  'ai-configs': ['AiServiceConfigs', 'SelfCanManage'],
  settings: ['Workers', 'AppChatbotAiConfig', 'AppSaturationAlarmWakeRoles', 'ChatAiConfigChoices', 'ResolveAiServiceConfigs', 'SelfCanManage', 'AppMemoryScope', 'AppAttachedMemories'],
  'node-role-templates': ['RoleTemplates', 'AppViewerManages', 'ConfigMemoryChoices'],
  secrets: ['AppSecrets', 'SecretChangeRequestState'],
  tickers: ['AppTickers', 'AppTickerSettings', 'AppDeliverySettings'],
  stops: ['TeamStopSignals', 'AppViewerManages', 'StopWorkers', 'StopPeople'],
  channels: ['AppChannelsApp', 'AppChannels', 'RegisterEntriesByOwner', 'Workers', 'AppInstalledAgents', 'SelfCanManage'],
  client: ['SelfCanManage', 'AppKeys'],
};

const opSet = () => [...new Set(h.ops)].sort();
const expected = (tab: string) => [...new Set([...FRAME, ...TAB_OPS[tab]])].sort();
/** App Keys, AI Service Configs and Node-role templates are sections of Settings. A link that still says `?tab=keys` opens Settings with that
 *  section open, so its first screen is Settings' reads plus the section's own. */
const SECTION_TABS = ['keys', 'ai-configs', 'node-role-templates', 'secrets', 'tickers', 'stops', 'channels'];
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
    expect(opSet()).not.toContain('AppSecrets');
    expect(opSet()).not.toContain('AppTickers');
    expect(opSet()).not.toContain('StopWorkers');
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

  // portal#1718 (ruling 0273): the org's members (every member with their email) were selected by the frame's org read on every open of an
  // org-owned App, though only the Memory tab's create offer and the AI Config section read the viewer's role from them.
  it('an org-owned App\'s frame org read selects no members, and no tab but Memory and AI Config asks for them', async () => {
    h.opts.orgApp = true;
    for (const tab of ['profile', 'worklog', 'chats', 'staff', 'members', 'agents', 'keys', 'client', 'runs', 'settings', 'node-role-templates']) {
      h.ops.length = 0;
      await loadPage(`?tab=${tab}`);
      expect(h.docs.AppDetailOrg, `?tab=${tab}`).not.toMatch(/\bmembers\b/);
      expect(opSet(), `?tab=${tab}`).not.toContain('AppOrgMembers');
    }
  });

  it.each(['memory', 'ai-configs'])('an org-owned App opening ?tab=%s reads the viewer\'s org role (its own request), and only then', async (tab) => {
    h.opts.orgApp = true;
    await loadPage(`?tab=${tab}`);
    expect(opSet()).toContain('AppOrgMembers');
    expect(h.docs.AppOrgMembers).toMatch(/\bmembers\b/);
  });

  it('?tab=settings&section=ai-configs on an org-owned App reads the role for the open section', async () => {
    h.opts.orgApp = true;
    await loadPage('?tab=settings&section=ai-configs');
    expect(opSet()).toContain('AppOrgMembers');
  });

  it('a personal App opening ?tab=memory or ?tab=ai-configs makes no members request', async () => {
    for (const tab of ['memory', 'ai-configs']) {
      h.ops.length = 0;
      const payload = await loadPage(`?tab=${tab}`);
      expect(opSet(), `?tab=${tab}`).not.toContain('AppOrgMembers');
      expect(payload.orgMembers ?? null).toBeNull();
    }
  });

  it('a failing members read fails the load (never an empty list that hides the controls)', async () => {
    h.opts.orgApp = true;
    h.opts.membersFail = true;
    await expect(loadPage('?tab=memory')).rejects.toBeDefined();
  });

  it('the Memory tab\'s create offer still follows the viewer\'s org role, now from the members read', async () => {
    h.opts.orgApp = true;
    const payload = await loadPage('?tab=memory');
    expect(payload.canCreateMemory).toBe(true);
    expect(payload.orgMembers).toEqual([{ id: 'm1', role: 'ADMIN', user: { id: 'u1' } }]);
  });

  it('a first load that does not read the members does not carry the key (it would overwrite a tab payload that did)', async () => {
    h.opts.orgApp = true;
    const payload = await loadPage('?tab=worklog');
    expect('orgMembers' in payload).toBe(false);
  });

  it('a live stop naming a worker brings the worker names into the frame, for the banner', async () => {
    h.opts.liveWorkerStop = true;
    await loadPage('?tab=worklog');
    expect(opSet()).toEqual([...FRAME, 'Workers', 'TeamWorkItems'].sort());
  });
});
