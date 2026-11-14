import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CHAT_ROOTS_PAGE_QUERY, APP_NODES_PAGE_QUERY, APP_MEMBERS_QUERY, APP_QUERY, CREATE_NODE_MUTATION, LEGACY_THREAD_PROBE_QUERY, NODES_BY_LOC_PREFIX_QUERY, NODE_BY_ID_QUERY, SELF_CAN_MANAGE_QUERY } from './queries';
import { chatPostTarget, postChatMessage } from './team-chat';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: (token: string) => { expect(token).toBe('viewer-token'); return { request: mockRequest }; } }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn().mockResolvedValue([]) }));
const loc = 'chats:private-fixture';
let root: Record<string, any> | null;
let failRead = false;
let thread: Array<Record<string, any>> | null = null;
const base = () => ({ id: 'root', loc, name: 'Synthetic chat', nodeType: 'chat', tags: [], memoryId: 'mem',
  memory: { id: 'mem', urn: 'hrn:mem:fixture.test:chat', appId: 'app', app: { id: 'app', name: 'Fixture', urn: 'hrn:app:fixture.test:fixture' } },
  outgoingEdges: [], incomingEdges: [], createdAt: '', updatedAt: '' });
const reads = serveMemoryReads([], { id: 'mem', urn: 'hrn:mem:fixture.test:chat' });
beforeEach(() => {
  root = base(); failRead = false; thread = null; mockRequest.mockReset();
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, any>) => {
    const served = reads(doc, vars); if (served !== undefined) return served;
    if (doc === NODE_BY_ID_QUERY) return { node: root };
    if (doc === LEGACY_THREAD_PROBE_QUERY) return { findNodes: { total: 1, hits: [{ node: { loc: `${loc}:messages:001-fixture`, nodeType: 'message' } }] } };
    if (doc === APP_QUERY) return { app: { id: 'app', name: 'Fixture', urn: 'hrn:app:fixture.test:fixture', organizationId: null, appType: 'CHATBOT', role: 'ADMIN', agentId: null, agent: null, createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14 } };
    if (doc === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (doc === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
    if (doc === APP_NODES_PAGE_QUERY) return { appNodesPage: { items: [], total: 0, hasMore: false } };
    if (doc === APP_CHAT_ROOTS_PAGE_QUERY) {
      const items = root ? [root] : [];
      return { appNodesPage: { items, total: items.length, hasMore: false } };
    }
    if (doc === CREATE_NODE_MUTATION) {
      const n = { ...vars.input, id: 'written-legacy', seq: null, createdAt: '2026-11-01T00:00:00Z' };
      (thread ??= []).push(n);
      return { createNode: n };
    }
    if (doc === NODES_BY_LOC_PREFIX_QUERY) {
      if (failRead) throw new Error('induced transcript failure');
      const type = root?.nodeType === 'chat' ? 'chat-message' : 'message';
      if (Array.isArray(vars.nodeTypes) && !vars.nodeTypes.length) throw new Error('BAD_USER_INPUT empty nodeTypes');
      const rows = thread ?? [{ id: 'm1', loc: `${loc}:messages:001-fixture`, name: 'Synthetic', nodeType: type, seq: 1001, content: 'fixture transcript', createdAt: '2026-11-01T00:00:00Z' }];
      const filtered = rows.filter(n => vars.nodeTypes ? vars.nodeTypes.includes(n.nodeType) : vars.nodeType ? n.nodeType === vars.nodeType : n.nodeType !== 'chat-message')
        .sort((a, b) => vars.sort === 'loc' ? a.loc.localeCompare(b.loc) :
          a.seq == null ? (b.seq == null ? a.loc.localeCompare(b.loc) : 1) : b.seq == null ? -1 : a.seq - b.seq || a.loc.localeCompare(b.loc));
      return { findNodes: { total: filtered.length, hits: filtered.slice(vars.offset, vars.offset + vars.limit).map(node => ({ node })) } };

    }
    return { memories: { items: [], total: 0 } };
  });
});
function event() {
  return { params: { id: 'mem', nodeId: 'root', appId: 'app' }, locals: { token: 'viewer-token', user: { id: 'user', handle: 'synthetic' } },
    parent: async () => ({ graph: { id: 'mem', urn: 'hrn:mem:fixture.test:chat', appId: 'app' }, isConsumerMode: false, activeOrgId: 'org' }),
    depends: () => {}, url: new URL(`http://localhost/app/memories/mem/nodes/root?before=10&nodeType=chat-message&loc=untrusted&chat=${loc}&tab=chats`) };
}
const transcriptVars = () => mockRequest.mock.calls.filter(([doc]) => doc === NODES_BY_LOC_PREFIX_QUERY).map(([, vars]) => vars);
async function inline() { const { load } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/+page.server'); return await load(event() as never) as any; }
async function fullscreen() { const { load } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/chat/+page.server'); return await load(event() as never) as any; }
async function older() { const { GET } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/chat-older/+server'); return await GET(event() as never); }
async function appPage() { const { load } = await import('../../routes/app/apps/[appId]/+page.server'); return await load(event() as never) as any; }

describe('portal#1569 authenticated-root transcript callers', () => {
  it.each([
    ['inline', inline, 'chatMessages'], ['full-screen', fullscreen, 'messages'], ['App other-chat', appPage, 'selectedChatMessages'],
  ] as const)('%s survives candidate2836 exclusion', async (_name, run, key) => {
    const data = await run();
    expect(data[key]?.messages ?? data[key]).toMatchObject([{ id: 'm1', content: 'fixture transcript', seq: 1001 }]);
    expect(transcriptVars()).toHaveLength(1);
    expect(transcriptVars()[0]).toMatchObject({ nodeTypes: ['chat-message', 'message'], memoryId: 'mem', locPrefix: `${loc}:messages:` });
  });
  it('older endpoint qualifies from the re-read root', async () => {
    const response = await older();
    expect(response.status).toBe(200);
    expect((await response.json()).messages).toMatchObject([{ id: 'm1' }]);
    expect(transcriptVars()[0].nodeTypes).toEqual(['chat-message', 'message']);
  });
  it.each([
    ['inline', inline, 'chatMessages'], ['full-screen', fullscreen, 'messages'], ['App other-chat', appPage, 'selectedChatMessages'],
  ] as const)('%s reads back a legal legacy write under a chat root (Gaia P2)', async (_name, run, key) => {
    root = { ...base(), tags: ['team-chat'] };
    const target = chatPostTarget(root as never);
    expect(target.kind).toBe('legacy');
    await postChatMessage({ request: mockRequest } as never, { target, memoryId: 'mem', chatLoc: loc, author: 'synthetic', content: 'round trip' });
    expect(thread?.map(n => n.nodeType)).toEqual(['message']);
    const data = await run();
    expect(data[key]?.messages ?? data[key]).toMatchObject([{ id: 'written-legacy', content: 'round trip', seq: null }]);
    expect(transcriptVars()[0].nodeTypes).toEqual(['chat-message', 'message']);
  });
  it('older endpoint reads the legal legacy write under a chat root', async () => {
    root = { ...base(), tags: ['team-chat'] };
    await postChatMessage({ request: mockRequest } as never, { target: chatPostTarget(root as never), memoryId: 'mem', chatLoc: loc, author: 'synthetic', content: 'round trip' });
    expect((await (await older()).json()).messages).toMatchObject([{ id: 'written-legacy', content: 'round trip' }]);
    expect(transcriptVars()[0].nodeTypes).toEqual(['chat-message', 'message']);
  });
  it.each([
    ['inline', inline, 'chatMessages'], ['full-screen', fullscreen, 'messages'], ['App other-chat', appPage, 'selectedChatMessages'],
  ] as const)('%s preserves adopted mixed history with nested rows filtered', async (_name, run, key) => {
    thread = [
      { id: 'p1', nodeType: 'chat-message', seq: 1001, loc: `${loc}:messages:1001-p`, content: 'platform' },
      { id: 'l1', nodeType: 'message', seq: null, loc: `${loc}:messages:20261101-l`, data: { body: 'history' } },
      { id: 'nested', nodeType: 'message', seq: null, loc: `${loc}:messages:20261101-l:attachment` },
      { id: 'note', nodeType: 'record', seq: 1002, loc: `${loc}:messages:note` },
    ];
    const data = await run();
    expect((data[key]?.messages ?? data[key]).map((m: { id: string }) => m.id)).toEqual(['p1', 'l1']);
  });
  it('older endpoint preserves adopted mixed history', async () => {
    thread = [
      { id: 'p1', nodeType: 'chat-message', seq: 1001, loc: `${loc}:messages:1001-p` },
      { id: 'l1', nodeType: 'message', seq: null, loc: `${loc}:messages:20261101-l` },
    ];
    expect((await (await older()).json()).messages.map((m: { id: string }) => m.id)).toEqual(['p1', 'l1']);
  });
  it.each([inline, fullscreen, older])('legacy root ignores a forged URL dialect and retains unqualified reads', async run => {
    root = { ...base(), nodeType: 'info', tags: ['team-chat'] };
    await run();
    expect(transcriptVars()).toHaveLength(1);
    expect(transcriptVars()[0]).not.toHaveProperty('nodeTypes');
    expect(transcriptVars()[0]).toMatchObject({ sort: 'loc', locPrefix: `${loc}:messages:` });
  });
  it('App entry with missing root type never infers platform from default seq sort', async () => {
    root = base(); delete root.nodeType;
    await appPage();
    expect(transcriptVars()).toHaveLength(1);
    expect(transcriptVars()[0]).not.toHaveProperty('nodeTypes');
  });
  it.each([null, { ...base(), nodeType: 'info', tags: [] }, { ...base(), memoryId: 'other-memory' }])('older refuses missing/non-chat/foreign-memory root before transcript fetch', async denied => {
    root = denied;
    const response = await older();
    expect(response.status).toBe(404);
    expect(transcriptVars()).toHaveLength(0);
  });
  it('older signals failed read rather than exhaustion', async () => {
    failRead = true;
    const response = await older();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ loadFailed: true, reason: 'fetch-failed' });
  });
});
