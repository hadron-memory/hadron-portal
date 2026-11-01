import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn() }));
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { canCreateAppMemory, readAppMemories } from './app-memories';
it.each(['OWNER','ADMIN','CONTRIBUTOR','READER'])('creation visibility follows the current user org role %s', role => {
 expect(canCreateAppMemory({members:[{role,user:{id:'me'}},{role:'OWNER',user:{id:'other'}}]},'me')).toBe(['OWNER','ADMIN'].includes(role));
});
it('fails closed without a known org membership or signed-in user',()=>{
 expect(canCreateAppMemory(null,'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'other'}}]},'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'me'}}]},null)).toBe(false);
});
it('drains a server-clamped list before filtering app-scoped memories',async()=>{
 const request=vi.fn().mockResolvedValueOnce({memories:{items:[{id:'other',appId:'elsewhere'}],total:2}}).mockResolvedValueOnce({memories:{items:[{id:'ours',appId:'a'}],total:2}});
 expect(await readAppMemories({request} as never,'o','a')).toEqual([{id:'ours',appId:'a'}]);
 expect(request.mock.calls.map(c=>c[1])).toEqual([{orgId:'o',limit:200,offset:0},{orgId:'o',limit:200,offset:1}]);
 expect(request.mock.calls[0][0]).toContain('memoryClasses: [app]');
});
it('reports a failed memory list instead of claiming it is empty',async()=>{
 expect(await readAppMemories({request:vi.fn().mockRejectedValue(new Error('offline'))} as never,'o','a')).toBeNull();
});
// #1451 Ask 2: a user-owned App has no org to list through, so its app memories
// come from appMemoryScope (hadron-server#2861), keeping the APP_MEMORY rows.
describe('app memories of an App with no organization', () => {
  const row = (id: string, kinds: (string | [string, string])[]) => ({
    memoryId: id, memoryUrn: `hrn:mem:example.com:${id}`, name: `Memory ${id}`,
    sources: kinds.map(k => (Array.isArray(k) ? { kind: k[0], agentId: k[1] } : { kind: k, agentId: null })),
  });
  it('reads the App scope and keeps only the free-standing app memories', async () => {
    const request = vi.fn().mockResolvedValue({ appMemoryScope: { total: 4, items: [
      row('mine', ['APP_MEMORY']), row('team', ['TEAM_SPACE']), row('agent', [['AGENT_SYSTEM', 'ag1']]), row('also', ['APP_MEMORY', ['AGENT_LINK', 'ag1']]),
    ] } });
    expect(await readAppMemories({ request } as never, null, 'a')).toEqual([
      { id: 'mine', urn: 'hrn:mem:example.com:mine', name: 'Memory mine', description: null, appId: 'a' },
      { id: 'also', urn: 'hrn:mem:example.com:also', name: 'Memory also', description: null, appId: 'a' },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('appMemoryScope(appRef: $appRef');
    expect(request.mock.calls[0][1]).toEqual({ appRef: 'a', limit: 200, offset: 0 });
  });
  it('never asks the org list, which a user-owned App has none of', async () => {
    const request = vi.fn().mockResolvedValue({ appMemoryScope: { total: 0, items: [] } });
    await readAppMemories({ request } as never, null, 'a');
    expect(request.mock.calls.every(c => !String(c[0]).includes('memories('))).toBe(true);
  });
  it('drains every page of the scope before filtering', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ appMemoryScope: { total: 2, items: [row('team', ['TEAM_SPACE'])] } })
      .mockResolvedValueOnce({ appMemoryScope: { total: 2, items: [row('late', ['APP_MEMORY'])] } });
    expect((await readAppMemories({ request } as never, null, 'a'))?.map(m => m.id)).toEqual(['late']);
    expect(request.mock.calls.map(c => c[1])).toEqual([{ appRef: 'a', limit: 200, offset: 0 }, { appRef: 'a', limit: 200, offset: 1 }]);
  });
  it('is empty, not failed, when the App has no app memories', async () => {
    const request = vi.fn().mockResolvedValue({ appMemoryScope: { total: 1, items: [row('team', ['TEAM_SPACE'])] } });
    expect(await readAppMemories({ request } as never, null, 'a')).toEqual([]);
  });
  it('reports a failed read instead of claiming it is empty', async () => {
    expect(await readAppMemories({ request: vi.fn().mockRejectedValue(new Error('offline')) } as never, null, 'a')).toBeNull();
  });
});

it('bounds an optional list outage instead of hanging the App page',async()=>{
 vi.useFakeTimers();
 try { const pending=readAppMemories({request:vi.fn(()=>new Promise(()=>{}))} as never,'o','a');
 await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);expect(await pending).toBeNull();
 }finally{vi.useRealTimers();}
});

// #1451: a user-owned App has no org, so the offer follows the viewer's manage
// right on the App (the owner, per effectiveAccess). The server stays the gate.
describe('create offer for an App with no organization', () => {
  it('is shown to the viewer who can manage the App', () => {
    expect(canCreateAppMemory(null, 'me', { userOwned: true, canManageApp: true })).toBe(true);
  });
  it.each([false, null])('is hidden when manage is %s (not the owner, or unknown)', canManageApp => {
    expect(canCreateAppMemory(null, 'me', { userOwned: true, canManageApp })).toBe(false);
  });
  it('is hidden when signed out', () => {
    expect(canCreateAppMemory(null, null, { userOwned: true, canManageApp: true })).toBe(false);
  });
  it('does not widen an org-owned App: manage alone never offers it', () => {
    expect(canCreateAppMemory({ members: [{ role: 'READER', user: { id: 'me' } }] }, 'me', { userOwned: false, canManageApp: true })).toBe(false);
    expect(canCreateAppMemory({ members: [{ role: 'ADMIN', user: { id: 'me' } }] }, 'me', { userOwned: false, canManageApp: false })).toBe(true);
  });
});

// #1043: the projection is caller-specific (participant vs org reader). The
// client preserves the exact admitted leaf set rather than folding Agents.
describe('complete App memory scope', () => {
  const leaf = (n: number) => ({ memoryId: `m${n}`, memoryUrn: `hrn:mem:example.com:m${n}`, name: `M${n}`, class: 'knowledge', viewerCanWrite: false, sources: [{ kind: 'AGENT_LINK', agentId: 'role-agent' }] });
  it('drains server-clamped pages beyond twenty, preserving every leaf and no nested reads', async () => {
    const { readAppMemoryScope } = await import('./app-memories');
    const rows = Array.from({ length: 23 }, (_, n) => leaf(n));
    const request = vi.fn().mockResolvedValueOnce({ appMemoryScope: { items: rows.slice(0, 20), total: 23 } }).mockResolvedValueOnce({ appMemoryScope: { items: rows.slice(20), total: 23 } });
    expect(await readAppMemoryScope({ request } as never, 'a')).toEqual(rows);
    expect(request.mock.calls.map(c => c[1])).toEqual([{ appRef: 'a', limit: 200, offset: 0 }, { appRef: 'a', limit: 200, offset: 20 }]);
    expect(request.mock.calls.every(c => String(c[0]).includes('viewerCanWrite') && String(c[0]).includes('agentId'))).toBe(true);
  });
  it('distinguishes a refused scope from a successful empty scope', async () => {
    const { readAppMemoryScope } = await import('./app-memories');
    expect(await readAppMemoryScope({ request: vi.fn().mockRejectedValue(new Error('FORBIDDEN')) } as never, 'a')).toBeNull();
    expect(await readAppMemoryScope({ request: vi.fn().mockResolvedValue({ appMemoryScope: { items: [], total: 0 } }) } as never, 'a')).toEqual([]);
  });
  it('keeps non-participant reader scope without manufacturing a team space', async () => {
    const { readAppMemoryScope } = await import('./app-memories');
    const request = vi.fn().mockResolvedValue({ appMemoryScope: { items: [leaf(1)], total: 1 } });
    expect(await readAppMemoryScope({ request } as never, 'a')).toEqual([leaf(1)]);
  });
});

it('selects every leaf field used by summaries and upload selection (GraphQL AST)', async () => {
 const { parse, Kind } = await import('graphql');
 const { APP_MEMORY_SCOPE_QUERY } = await import('./app-memories');
 const operation=parse(APP_MEMORY_SCOPE_QUERY).definitions.find(d=>d.kind===Kind.OPERATION_DEFINITION)!;
 if(operation.kind!==Kind.OPERATION_DEFINITION)throw new Error('missing query');
 const scope=operation.selectionSet.selections.find(s=>s.kind===Kind.FIELD&&s.name.value==='appMemoryScope');
 if(scope?.kind!==Kind.FIELD)throw new Error('missing scope');
 const items=scope.selectionSet!.selections.find(s=>s.kind===Kind.FIELD&&s.name.value==='items');
 if(items?.kind!==Kind.FIELD)throw new Error('missing items');
 expect(items.selectionSet!.selections.filter(s=>s.kind===Kind.FIELD).map(s=>s.name.value)).toEqual(expect.arrayContaining(['memoryId','memoryUrn','name','class','viewerCanWrite','sources']));
 const sources=items.selectionSet!.selections.find(s=>s.kind===Kind.FIELD&&s.name.value==='sources');
 if(sources?.kind!==Kind.FIELD)throw new Error('missing sources');
 expect(sources.selectionSet!.selections.filter(s=>s.kind===Kind.FIELD).map(s=>s.name.value)).toEqual(['kind','agentId']);
});
