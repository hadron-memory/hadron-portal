/**
 * #1451 — the App page offers the create-memory form to the owner of a
 * user-owned App (no organization), and only to them. The loader's offer rule
 * reads the viewer's manage right on the App; the server stays the gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, Kind, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import { APP_QUERY, APP_DETAIL_ORG_QUERY, APP_MEMBERS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const APP = {
  id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app', organizationId: null,
  appType: 'CHATBOT', role: 'ADMIN', description: null, systemPrompt: null, createUserPermission: 'DENY',
  identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14, agentId: null, agent: null,
};

// Restored per test: the config sets no restoreMocks, so an unrestored spy
// would swallow console output for every later test in the worker.
const consoleSpies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  while (consoleSpies.length) consoleSpies.pop()!.mockRestore();
});

beforeEach(() => {
  mockRequest.mockReset();
  consoleSpies.push(
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  );
  // The App is the one read the forms hang off; every other read is empty, which
  // the loader treats as "none".
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app: APP };
    if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
    return { appNodesPage: { items: [], total: 0, hasMore: false } };
  });
});


async function loadAs(canManage: boolean) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app: APP };
    if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage } };
    return { appNodesPage: { items: [], total: 0, hasMore: false } };
  });
  const { load } = await import('./+page.server');
  return (await load({
    params: { id: 'org-1', appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'user-1' } },
    parent: async () => ({}),
    depends: () => {},
    url: new URL('http://localhost/app/apps/app-1?tab=memory'),
  } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
}

describe('create-memory offer on a user-owned App', () => {
  it('is offered to the owner (manage right)', async () => {
    expect((await loadAs(true)).canCreateMemory).toBe(true);
  });
  it('is not offered to a viewer who cannot manage the App', async () => {
    expect((await loadAs(false)).canCreateMemory).toBe(false);
  });
});

it('loader carries the scope and reuses it for a user-owned App creation panel without a duplicate read (#1043)', async () => {
 const { fetchAllItems }=await import('$lib/server/paginate');
 const { APP_MEMORY_SCOPE_QUERY }=await import('./app-memories');
 const rows=[{memoryId:'team',memoryUrn:'hrn:mem:example.com:team',name:'Team',class:'app',viewerCanWrite:true,sources:[{kind:'TEAM_SPACE',agentId:null}]},{memoryId:'free',memoryUrn:'hrn:mem:example.com:free',name:'Free',class:'app',viewerCanWrite:true,sources:[{kind:'APP_MEMORY',agentId:null}]}];
 vi.mocked(fetchAllItems).mockImplementation(async (_client, query) => query===APP_MEMORY_SCOPE_QUERY ? rows : []);
 vi.mocked(fetchAllItems).mockClear();
 try {
  const result=await loadAs(true);
  expect(result.appMemoryScope).toEqual(rows);
  expect(result.appMemories).toEqual([{id:'free',urn:'hrn:mem:example.com:free',name:'Free',description:null,appId:'app-1'}]);
  expect(vi.mocked(fetchAllItems).mock.calls.filter(c=>c[1]===APP_MEMORY_SCOPE_QUERY)).toHaveLength(1);
 }finally { vi.mocked(fetchAllItems).mockResolvedValue([]); }
});

// #1552: an org App's creation panel keeps the descriptions the org memory list
// carries, while appMemoryScope stays the complete authorized scope. The two
// sets differ on purpose here (a described app memory the scope lacks, and
// scope rows the org list lacks), so substituting either for the other fails.
it('org-App loader keeps creation-panel description rows distinct from the full scope (#1552)', async () => {
  const { fetchAllItems } = await import('$lib/server/paginate');
  const { APP_MEMORIES_QUERY, APP_MEMORY_SCOPE_QUERY } = await import('./app-memories');
  const orgRows = [
    { id: 'described', urn: 'hrn:mem:example.com:described', name: 'Described', description: 'Shared notes', appId: 'app-1' },
    { id: 'elsewhere', urn: 'hrn:mem:example.com:elsewhere', name: 'Elsewhere', description: 'Other App', appId: 'app-2' },
  ];
  const scopeRows = [
    { memoryId: 'team', memoryUrn: 'hrn:mem:example.com:team', name: 'Team', class: 'app', viewerCanWrite: true, sources: [{ kind: 'TEAM_SPACE', agentId: null }] },
    { memoryId: 'free', memoryUrn: 'hrn:mem:example.com:free', name: 'Free', class: 'app', viewerCanWrite: true, sources: [{ kind: 'APP_MEMORY', agentId: null }] },
  ];
  vi.mocked(fetchAllItems).mockImplementation(async (_client, query) =>
    query === APP_MEMORIES_QUERY ? orgRows : query === APP_MEMORY_SCOPE_QUERY ? scopeRows : []);
  try {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === APP_QUERY) return { app: { ...APP, organizationId: 'org-1' } };
      if (query === APP_DETAIL_ORG_QUERY) return { organization: { id: 'org-1', name: 'Org', urn: 'hrn:org:example.com', members: [] } };
      if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
      if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
      return { appNodesPage: { items: [], total: 0, hasMore: false } };
    });
    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1?tab=memory'),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
    // description rows: this App's org memories only, descriptions intact
    expect(result.appMemories).toEqual([orgRows[0]]);
    // full scope: exactly the authorized leaves, not the org list
    expect(result.appMemoryScope).toEqual(scopeRows);
  } finally {
    vi.mocked(fetchAllItems).mockReset();
    vi.mocked(fetchAllItems).mockResolvedValue([]);
  }
});

// portal#1391: the create offer is only as good as the member selection it reads. canCreateMemory comes from
// APP_DETAIL_ORG_QUERY's members (role + user id); a query that stops selecting them fails the offer closed silently.
describe('canCreateMemory follows APP_DETAIL_ORG_QUERY member selection (portal#1391)', () => {
  it('the query document selects each member role and user id', () => {
    const doc = parse(APP_DETAIL_ORG_QUERY);
    const fragments = new Map(doc.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map((d) => [d.name.value, d]));
    const paths: string[] = [];
    const walk = (set: SelectionSetNode, path: string, seen: Set<string>) => {
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) { const here = `${path}${sel.name.value}`; paths.push(here); if (sel.selectionSet) walk(sel.selectionSet, `${here}.`, seen); }
        else if (sel.kind === Kind.INLINE_FRAGMENT) walk(sel.selectionSet, path, seen);
        else if (!seen.has(sel.name.value)) { const f = fragments.get(sel.name.value); if (f) walk(f.selectionSet, path, new Set(seen).add(sel.name.value)); }
      }
    };
    for (const d of doc.definitions) if (d.kind === Kind.OPERATION_DEFINITION) walk(d.selectionSet, '', new Set());
    expect(paths).toEqual(expect.arrayContaining(['organization.members.role', 'organization.members.user.id']));
  });
  it.each([['ADMIN', true], ['OWNER', true], ['CONTRIBUTOR', false], ['READER', false]])('the viewer as org %s: canCreateMemory is %s', async (role, expected) => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === APP_QUERY) return { app: { ...APP, organizationId: 'org-1' } };
      if (query === APP_DETAIL_ORG_QUERY) return { organization: { id: 'org-1', name: 'Org', urn: 'hrn:org:example.com', members: [{ id: 'mem-1', role, user: { id: 'user-1' } }, { id: 'mem-2', role: 'OWNER', user: { id: 'someone-else' } }] } };
      if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
      if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
      return { appNodesPage: { items: [], total: 0, hasMore: false } };
    });
    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' }, locals: { token: 'tok', user: { id: 'user-1' } }, parent: async () => ({}), depends: () => {},
      url: new URL('http://localhost/app/apps/app-1?tab=memory'),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
    expect(result.canCreateMemory).toBe(expected);
  });
});
