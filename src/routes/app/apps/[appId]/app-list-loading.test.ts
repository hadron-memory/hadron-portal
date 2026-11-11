import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOperationAST, parse } from 'graphql';
import type { AiServiceConfig, TeamWorkItem } from '$lib/types';
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
      case 'AppRuns': return { appRuns: { items: [], total: 0 } };
      case 'AgentTasksApp': return { app: { id: APP_ID, name: 'App', urn: 'hrn:app:example.test:demo', organizationId: null } };
      case 'AppInstalledAgents': return { app: { appAgents: [] } };
      case 'TeamChatMessages': return { teamChatMessages: { items: [], total: 0 } };
      case 'AppKeys': case 'AppKeyScopes': return { appKeysPage: { items: [], total: 0, hasMore: false } };
      case 'SelfCanManage': return { effectiveAccess: { canManage: false } };
      case 'AppViewerManages': return { app: { viewerManages: false } };
      case 'AppTeamRoster': return { teamRoster: { workers: [] } };
      case 'AppBootPointers': case 'AppInstallMarks': return { app: { id: APP_ID, appAgents: [] } };
      case 'TeamStopSignals': return { teamStopSignals: { signals: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      case 'AppProperties': return { app: { properties: {} } };
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
    const result = await loadPage();
    expect(calls.filter(c => c.name === 'TeamWorkItems').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(result.worklog).toHaveLength(20);
    expect(result.worklogTotal).toBe(41);
  });
  it('does not drain 201 configs on first load: asks for 20 and preserves the count', async () => {
    const result = await loadPage();
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
  it('defaults the Memory/Flows and legacy chat-root lists to independent pages of 20', async () => {
    const result = await loadPage('?tab=runs');
    expect(calls.filter(c => c.name === 'AppNodesPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(calls.filter(c => c.name === 'AppChatRootsPage').map(c => c.variables)).toEqual([
      expect.objectContaining({ appRef: APP_ID, limit: 20, offset: 0 }),
    ]);
    expect(calls.filter(c => ['AppNodes', 'AppChatRoots'].includes(c.name))).toEqual([]);
    expect(result.appNodes).toHaveLength(20);
    expect(result.appNodesPage).toMatchObject({ offset: 0, count: 20, total: 45 });
    expect(result.chatRootsPage).toMatchObject({ offset: 0, count: 20, total: 25 });
    expect(result.runsPanel).toMatchObject({ flowsPage: { offset: 0, count: 20, total: 45 } });
    expect(result).not.toHaveProperty('appNodesCapped');
    expect(result).not.toHaveProperty('chatsCapped');
    expect(result.runsPanel).not.toHaveProperty('flowsCapped');
  });
  it('continues each App node list by its own URL offset', async () => {
    const result = await loadPage('?tab=memory&appNodesOffset=20&chatRootsOffset=20');
    expect(calls.find(c => c.name === 'AppNodesPage')?.variables).toMatchObject({ limit: 20, offset: 20 });
    expect(calls.find(c => c.name === 'AppChatRootsPage')?.variables).toMatchObject({ limit: 20, offset: 20 });
    expect(result.appNodes).toEqual(nodes.slice(20, 40));
    expect(result.appNodesPage).toMatchObject({ offset: 20, count: 20, total: 45 });
    expect(result.chatRootsPage).toMatchObject({ offset: 20, count: 5, total: 25 });
  });
  it('retains complete staff and channel identity contexts, including rows beyond 200', async () => {
    const result = await loadPage();
    expect(result.staff).toHaveLength(201);
    expect(result.staff).toEqual(staff);
    expect(result.appChats).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: 'channel-200' })]));
    expect(calls.filter(c => c.name === 'Workers').map(c => c.variables.offset)).toEqual([0, 200]);
    expect(calls.filter(c => c.name === 'AppChannels').map(c => c.variables.offset)).toEqual([0, 200]);
  });
});
