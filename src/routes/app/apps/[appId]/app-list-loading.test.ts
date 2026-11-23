import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOperationAST, parse } from 'graphql';
import type { AiServiceConfig, TeamWorkItem } from '$lib/types';
import type { FlowGraphNode } from '$lib/flow/flows';
import { APP_FLOWS_PAGE_QUERY } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const APP_ID = 'app-a';
const configs: AiServiceConfig[] = Array.from({ length: 201 }, (_, i) => ({
  id: `config-${i}`, name: `Config ${i}`, ownerType: 'APP', ownerId: APP_ID,
  provider: 'anthropic', model: 'synthetic', endpoint: null, effectiveEndpoint: 'https://provider.invalid',
  apiStyle: null, effectiveApiStyle: null, hasApiKey: false, apiKeyPreview: null,
  params: null, enabled: false, createdAt: '2026-11-09T00:00:00Z', updatedAt: null,
}));
const work: TeamWorkItem[] = Array.from({ length: 41 }, (_, i) => ({
  nodeId: `record-${i}`, sessionId: `session-${i}`, workerId: null, workerName: 'Synthetic',
  tool: 'github', kind: 'pr', ref: `example/project#${i + 1}`, action: 'opened',
  at: new Date(Date.UTC(2026, 10, 9) - i * 1000).toISOString(), detail: null, model: null,
}));
const staff = Array.from({ length: 201 }, (_, i) => ({
  id: `worker-${i}`, name: `Worker ${i}`, urn: `hrn:worker:example.test:demo:worker-${i}`, retiredAt: null,
}));
const channels = Array.from({ length: 201 }, (_, i) => ({
  id: `channel-${i}`, name: `Channel ${i}`, loc: `chats:channel-${i}`, memoryId: 'memory-a',
  chatRootUrn: `hrn:node:example.test:demo:chats:channel-${i}`,
}));
const nodes = Array.from({ length: 45 }, (_, i) => ({
  id: `node-${i}`, urn: `hrn:node:example.test:demo:nodes:${i}`, memoryId: 'memory-a',
  nodeType: 'info', loc: `nodes:${i}`, name: `Node ${i}`, description: null, tags: [], seq: null,
  isRunnable: false, memory: { id: 'memory-a', urn: 'hrn:mem:example.test:demo', name: 'Memory', organizationId: null },
  outgoingEdges: [], incomingEdges: [],
}));
const legacyChatRoots = Array.from({ length: 25 }, (_, i) => ({
  id: `chat-${i}`, loc: `chats:${i}`, name: `Chat ${i}`, memoryId: 'memory-a', nodeType: 'chat',
}));
type Variables = Record<string, unknown>;
const calls: { name: string; variables: Variables }[] = [];
const unknown: string[] = [];
function page<T>(items: T[], variables: Variables) {
  const offset = Number(variables.offset ?? 0), limit = Number(variables.limit ?? 20);
  return { items: items.slice(offset, offset + limit), total: items.length, hasMore: offset + limit < items.length };
}
beforeEach(() => {
  request.mockReset(); calls.length = 0; unknown.length = 0;
  request.mockImplementation(async (document: string, variables: Variables = {}) => {
    const name = getOperationAST(parse(document))?.name?.value ?? 'unnamed';
    calls.push({ name, variables });
    switch (name) {
      case 'App': return { app: {
        id: APP_ID, name: 'App', urn: 'hrn:app:example.test:demo', organizationId: null,
        appType: 'CHATBOT', role: 'ADMIN', description: null, agentId: null, agent: null, agents: [],
        createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14,
      } };
      case 'AiServiceConfigs': return { aiServiceConfigs: page(configs, variables) };
      case 'Workers': return { workers: page(staff, variables) };
      case 'AppChannels': return { channels: page(channels, variables) };
      case 'TeamWorkItems': return { teamWorkItems: page(work, variables) };
      case 'AppMembers': return { app: { members: [] } };
      case 'AppNodes': case 'AppChatRoots': return { appNodes: [] };
      case 'AppNodesPage': return { appNodesPage: page(nodes, variables) };
      case 'AppChatRootsPage': return { appNodesPage: page(legacyChatRoots, variables) };
      case 'AppFlowsPage': return { appNodesPage: page(nodes, variables) };
      case 'AppRuns': return { appRuns: { items: [], total: 0 } };
      case 'AgentTasksApp': return { app: { id: APP_ID, name: 'App', urn: 'hrn:app:example.test:demo', organizationId: null } };
      case 'AppInstalledAgents': return { app: { appAgents: [] } };
      case 'TeamChatMessages': return { teamChatMessages: { items: [], total: 0 } };
      case 'NodesByLocPrefix': return { findNodes: { hits: [], total: 0 } };
      case 'AppKeys': case 'AppKeyScopes': return { appKeysPage: { items: [], total: 0, hasMore: false } };
      case 'SelfCanManage': return { effectiveAccess: { canManage: false } };
      case 'AppViewerManages': return { app: { viewerManages: false } };
      case 'AppTeamRoster': return { teamRoster: { workers: [] } };
      case 'AppBootPointers': case 'AppInstallMarks': return { app: { id: APP_ID, appAgents: [] } };
      case 'TeamStopSignals': return { teamStopSignals: { signals: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      case 'AppChatbotAiConfig': return { app: { id: APP_ID, chatbotAiConfigId: null } };
      case 'AppMemoryScope': return { appMemoryScope: { items: [], total: 0 } };
      case 'MyAgents': return { agents: { items: [], total: 0 } };
      case 'PublicAgents': return { publicAgents: { items: [], total: 0 } };
      case 'MemberOrgIds': return { organizations: { items: [], total: 0 } };
      default: unknown.push(name); throw new Error(`Missing synthetic fixture for ${name}`);
    }
  });
});
async function loadPage(search = '') {
  const { load } = await import('./+page.server');
  const result = await load({ params: { appId: APP_ID }, locals: { token: 'synthetic', user: { id: 'person-a' } },
    url: new URL(`http://portal.invalid/app/apps/${APP_ID}${search}`),
  } as never);
  expect(unknown).toEqual([]);
  return result as Record<string, unknown>;
}
describe('App display-list request boundaries (#1758)', () => {
  it('defaults worklog to one page of 20 while retaining its real total', async () => {
    const result = await loadPage('?tab=worklog');
    expect(calls.filter(c => c.name === 'TeamWorkItems').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(result.worklog).toHaveLength(20);
    expect(result.worklogTotal).toBe(41);
  });
  it('does not drain 201 configs on first load: asks for 20 and preserves the count', async () => {
    const result = await loadPage('?tab=ai-configs');
    expect(calls.filter(c => c.name === 'AiServiceConfigs').map(c => c.variables)).toEqual([
      expect.objectContaining({ ownerType: 'APP', ownerId: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(result.appConfigs).toHaveLength(20);
    expect(result.configsPage).toMatchObject({ total: 201 });
  });
  it('an explicit worklog continuation preserves server-side filters and reaches older rows', async () => {
    const result = await loadPage('?tab=worklog&worklogOffset=20&worklogRef=example%2Fproject%231&worklogKind=pr&worklogTool=github');
    expect(calls.find(c => c.name === 'TeamWorkItems')?.variables).toMatchObject({ limit: 20, offset: 20, ref: 'example/project#1', kind: 'pr', tool: 'github' });
    expect(result.worklog).toEqual(work.slice(20, 40));
    expect(result.worklogTotal).toBe(41);
  });
  it('an explicit config continuation reaches a later config without draining the remainder', async () => {
    const result = await loadPage('?tab=ai-configs&configOffset=20');
    expect(calls.filter(c => c.name === 'AiServiceConfigs').map(c => c.variables)).toEqual([
      expect.objectContaining({ limit: 20, offset: 20 }),
    ]);
    expect(result.appConfigs).toEqual(configs.slice(20, 40));
    expect(result.appConfigs).toHaveLength(20);
  });
  // portal#2240: each list is its own tab's read now, so each is opened on its tab.
  it('defaults the Memory/Flows and legacy chat-root lists to independent pages of 20', async () => {
    const runs = await loadPage('?tab=runs');
    expect(calls.filter(c => c.name === 'AppFlowsPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(calls.filter(c => c.name === 'AppNodes')).toHaveLength(1); // complete Flow graph, not the display list
    expect(runs.runsPanel).toMatchObject({ flowsPage: { offset: 0, count: 20, total: 45 } });
    expect(runs.runsPanel).not.toHaveProperty('flowsCapped');
    calls.length = 0;
    const memory = await loadPage('?tab=memory');
    expect(calls.filter(c => c.name === 'AppNodesPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(memory.appNodes).toHaveLength(20);
    expect(memory.appNodesPage).toMatchObject({ offset: 0, count: 20, total: 45 });
    expect(memory).not.toHaveProperty('appNodesCapped');
    calls.length = 0;
    const chats = await loadPage('?tab=chats');
    expect(calls.filter(c => c.name === 'AppChatRootsPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(calls.filter(c => c.name === 'AppChatRoots')).toEqual([]);
    expect(chats.chatRootsPage).toMatchObject({ offset: 0, count: 20, total: 25 });
    expect(chats).not.toHaveProperty('chatsCapped');
  });
  // #1929 LOCAL P3 / QA F4: a Flows pager over EVERY App node shows "No flows on
  // this page" whenever docs sort first. Flows page their own runnable-only window
  // on their own offset, independent of the Memory tab's node pages.
  it('pages Flows over runnable nodes on their own offset, independent of Memory node pages', async () => {
    const result = await loadPage('?tab=runs&flowsOffset=20&appNodesOffset=40');
    expect(calls.filter(c => c.name === 'AppFlowsPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 20 }),
    ]);
    expect(result.runsPanel).toMatchObject({ flowsPage: { offset: 20, count: 20, total: 45 } });
    const next = (result.runsPanel as { flowsPage: { nextHref: string | null } }).flowsPage.nextHref!;
    expect(new URL(next, 'https://x.test').searchParams.get('flowsOffset')).toBe('40');
    expect(new URL(next, 'https://x.test').searchParams.get('appNodesOffset')).toBe('40');
    expect(APP_FLOWS_PAGE_QUERY).toMatch(/isRunnable:\s*true/);
    // The Memory tab's node pages move on their own offset (portal#2240: on their own tab).
    calls.length = 0;
    await loadPage('?tab=memory&flowsOffset=20&appNodesOffset=40');
    expect(calls.find(c => c.name === 'AppNodesPage')?.variables).toMatchObject({ limit: 20, offset: 40 });
  });
  it('reads no Flows page outside the Runs tab', async () => {
    await loadPage('?tab=memory');
    expect(calls.filter(c => c.name === 'AppFlowsPage')).toEqual([]);
  });
  // #1929 QA F3: paging the chat list must not drop the conversation the reader has open.
  it('keeps the selected chat across chat-root page links', async () => {
    const result = await loadPage('?tab=chats&chat=chats%3A3');
    const next = (result.chatRootsPage as { nextHref: string | null }).nextHref!;
    expect(new URL(next, 'https://x.test').searchParams.get('chat')).toBe('chats:3');
    expect(new URL(next, 'https://x.test').searchParams.get('chatRootsOffset')).toBe('20');
  });
  it('starts the complete Flow graph read with the first independent loader round', async () => {
    const base = request.getMockImplementation()!;
    let releaseApp!: () => void;
    const appGate = new Promise<void>((resolve) => { releaseApp = resolve; });
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'App') await appGate;
      return base(document, variables);
    });
    const pending = loadPage('?tab=runs');
    await vi.waitFor(() => expect(calls.some(c => c.name === 'AppNodes')).toBe(true));
    expect(calls.some(c => c.name === 'App')).toBe(false);
    releaseApp();
    await pending;
  });

  it('continues each App node list by its own URL offset', async () => {
    // portal#2240: the chat-root list is the Chats tab's read, so each list is
    // continued on its own tab, from the same URL offsets.
    const result = await loadPage('?tab=memory&appNodesOffset=20&chatRootsOffset=20');
    expect(calls.find(c => c.name === 'AppNodesPage')?.variables).toMatchObject({ limit: 20, offset: 20 });
    expect(result.appNodes).toEqual(nodes.slice(20, 40));
    expect(result.appNodesPage).toMatchObject({ offset: 20, count: 20, total: 45 });
    calls.length = 0;
    const chats = await loadPage('?tab=chats&appNodesOffset=20&chatRootsOffset=20');
    expect(calls.find(c => c.name === 'AppChatRootsPage')?.variables).toMatchObject({ limit: 20, offset: 20 });
    expect(chats.chatRootsPage).toMatchObject({ offset: 20, count: 5, total: 25 });
  });
  it('resolves a legacy chat deep link outside the current root page', async () => {
    const result = await loadPage('?tab=chats&chat=chats%3A24');
    expect(result.chatNotFound).toBe(false);
    expect(result.selectedChatKey).toBe('chats:24');
    const targeted = calls.filter(c => c.name === 'AppChatRootsPage' && c.variables.locPrefix === 'chats:24');
    expect(targeted.map(c => c.variables)).toEqual([expect.objectContaining({ offset: 0, limit: 200 })]);
  });

  it('resolves a later-page chat root whose loc has no chats: prefix', async () => {
    const base = request.getMockImplementation()!;
    const support = { id: 'support', loc: 'support', name: 'Support', memoryId: 'memory-a', nodeType: 'chat' };
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppChatRootsPage' && variables.locPrefix === 'support') {
        calls.push({ name, variables });
        return { appNodesPage: { items: [support], total: 1, hasMore: false } };
      }
      return base(document, variables);
    });
    const result = await loadPage('?tab=chats&chat=support');
    expect(result.chatNotFound).toBe(false);
    expect(result.selectedChatKey).toBe('support');
    expect(calls.filter(c => c.name === 'AppChatRootsPage' && c.variables.locPrefix === 'support')).toHaveLength(1);
  });
  it('counts Flow steps against the complete graph, not the 20-row display page', async () => {
    const root: FlowGraphNode = { ...nodes[0], id: 'flow-root', loc: 'flow:root', name: 'Root', isRunnable: true };
    const middle: FlowGraphNode = { ...nodes[1], id: 'flow-middle', loc: 'flow:middle', name: 'Middle', isRunnable: true };
    const last: FlowGraphNode = { ...nodes[2], id: 'flow-last', loc: 'flow:last', name: 'Last', isRunnable: true };
    root.outgoingEdges = [{ name: 'next', loc: 'flow:root:next:middle', target: { id: middle.id, loc: middle.loc, name: middle.name } }];
    root.incomingEdges = [];
    middle.outgoingEdges = [{ name: 'next', loc: 'flow:middle:next:last', target: { id: last.id, loc: last.loc, name: last.name } }];
    middle.incomingEdges = [{ name: 'next', loc: 'flow:root:next:middle', source: { id: root.id, loc: root.loc, name: root.name } }];
    last.outgoingEdges = [];
    last.incomingEdges = [{ name: 'next', loc: 'flow:middle:next:last', source: { id: middle.id, loc: middle.loc, name: middle.name } }];
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppFlowsPage') return { appNodesPage: { items: [root], total: 3, hasMore: true } };
      if (name === 'AppNodes') return { appNodes: [root, middle, last] };
      return base(document, variables);
    });
    const result = await loadPage('?tab=runs');
    expect(result.runsPanel).toMatchObject({ flows: [{ entry: { id: 'flow-root' }, stepCount: 3, stepCountComplete: true }] });
  });
  it('bounds an unresolved prefixed deep link to one lookup and discloses uncertainty', async () => {
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppChatRootsPage' && variables.locPrefix === 'chats:a') {
        calls.push({ name, variables });
        return { appNodesPage: { items: legacyChatRoots.slice(0, 20), total: 1000, hasMore: true } };
      }
      return base(document, variables);
    });
    const result = await loadPage('?tab=chats&chat=chats%3Aa');
    expect(result.chatNotFound).toBe(true);
    // #2170 F6: the chat list itself loaded; only the deep link is uncertain.
    expect(result.chatsError).toBe(false);
    expect(result.chatDeepLinkUnresolved).toBe(true);
    expect(calls.filter(c => c.name === 'AppChatRootsPage' && c.variables.locPrefix === 'chats:a')).toHaveLength(1);
  });

  it('a failed deep-link lookup is uncertainty about the link, not a failed chat list (#2170 F6)', async () => {
    const base = request.getMockImplementation()!;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppChatRootsPage' && variables.locPrefix === 'chats:gone') throw new Error('synthetic lookup failure');
      return base(document, variables);
    });
    const result = await loadPage('?tab=chats&chat=chats%3Agone');
    expect(result.chatsError).toBe(false);
    expect(result.chatDeepLinkUnresolved).toBe(true);
  });

  it('a failed chat-root page is still a chat-list failure, and no deep-link uncertainty is claimed (#2170 F6 control)', async () => {
    const base = request.getMockImplementation()!;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppChatRootsPage' && variables.locPrefix == null) throw new Error('synthetic page failure');
      return base(document, variables);
    });
    const result = await loadPage('?tab=chats');
    expect(result.chatsError).toBe(true);
    expect(result.chatDeepLinkUnresolved).toBe(false);
  });

  // #2170 F7: a failed Flows page read must be visible, not an empty list.
  it('reports a failed Flows page read instead of an empty Flows list', async () => {
    const base = request.getMockImplementation()!;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    request.mockImplementation(async (document: string, variables: Variables = {}) => {
      const name = getOperationAST(parse(document))?.name?.value;
      if (name === 'AppFlowsPage') throw new Error('synthetic Flows failure');
      return base(document, variables);
    });
    const result = await loadPage('?tab=runs');
    expect(result.runsPanel).toMatchObject({ flows: [], flowsError: true });
  });

  it('a successful Flows page read reports no Flows error (#2170 F7 control)', async () => {
    const result = await loadPage('?tab=runs');
    expect(result.runsPanel).toMatchObject({ flowsError: false });
  });

  it('retains complete staff and channel identity contexts, including rows beyond 200', async () => {
    const result = await loadPage('?tab=chats');
    expect(result.staff).toHaveLength(201);
    expect(result.staff).toEqual(staff);
    expect(result.appChats).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: 'channel-200' })]));
    expect(calls.filter(c => c.name === 'Workers').map(c => c.variables.offset)).toEqual([0, 200]);
    expect(calls.filter(c => c.name === 'AppChannels').map(c => c.variables.offset)).toEqual([0, 200]);
  });
});
