import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn() }));
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { gqlClient } from '$lib/server/api';
import { appMemoriesFromScope, attachMemory, canCreateAppMemory, readAppMemoryScope, readAttachableMemories } from './app-memories';
it.each(['OWNER','ADMIN','CONTRIBUTOR','READER'])('creation visibility follows the current user org role %s', role => {
 expect(canCreateAppMemory({members:[{role,user:{id:'me'}},{role:'OWNER',user:{id:'other'}}]},'me')).toBe(['OWNER','ADMIN'].includes(role));
});
it('fails closed without a known org membership or signed-in user',()=>{
 expect(canCreateAppMemory(null,'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'other'}}]},'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'me'}}]},null)).toBe(false);
});
// The list is the viewer's whole memory scope (cor:dmo:050:17), one row per memory, whatever put it in scope.
describe('the App memory list is the whole scope', () => {
  const row = (id: string, cls: string, kinds: string[]) => ({
    memoryId: id, memoryUrn: `hrn:mem:example.com:${id}`, name: `Memory ${id}`, class: cls, viewerCanWrite: true,
    sources: kinds.map(kind => ({ kind, agentId: null })),
  });
  it('keeps every source kind and carries each memory\'s class', () => {
    const scope = [row('mine', 'app', ['APP_MEMORY']), row('team', 'app', ['TEAM_SPACE']), row('agent', 'system', ['AGENT_SYSTEM']), row('own', 'personal', ['AGENT_LINK'])];
    expect(appMemoriesFromScope(scope, 'a')).toEqual([
      { id: 'mine', urn: 'hrn:mem:example.com:mine', name: 'Memory mine', class: 'app', appId: 'a' },
      { id: 'team', urn: 'hrn:mem:example.com:team', name: 'Memory team', class: 'app', appId: 'a' },
      { id: 'agent', urn: 'hrn:mem:example.com:agent', name: 'Memory agent', class: 'system', appId: 'a' },
      { id: 'own', urn: 'hrn:mem:example.com:own', name: 'Memory own', class: 'personal', appId: 'a' },
    ]);
  });
  it('is empty, not failed, for an empty scope; failed only when the scope was unavailable', () => {
    expect(appMemoriesFromScope([], 'a')).toEqual([]);
    expect(appMemoriesFromScope(null, 'a')).toBeNull();
  });
  it('reads the scope in full, page by page', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ appMemoryScope: { total: 2, items: [row('a1', 'app', ['TEAM_SPACE'])] } })
      .mockResolvedValueOnce({ appMemoryScope: { total: 2, items: [row('late', 'app', ['APP_MEMORY'])] } });
    expect((await readAppMemoryScope({ request } as never, 'a'))?.map(m => m.memoryId)).toEqual(['a1', 'late']);
    expect(request.mock.calls.map(c => c[1])).toEqual([{ appRef: 'a', limit: 200, offset: 0 }, { appRef: 'a', limit: 200, offset: 1 }]);
  });
});

// Adding an EXISTING memory: the server decides; the portal passes the three refs and speaks only fixed copy.
describe('attachMemory action', () => {
  const run = (fields: Record<string, string>, request: ReturnType<typeof vi.fn>) => {
    vi.mocked(gqlClient).mockReturnValue({ request } as never);
    const body = new FormData();
    for (const [k, v] of Object.entries({ _kind: 'attachAppMemory', ...fields })) body.set(k, v);
    return attachMemory({ request: new Request('http://x/', { method: 'POST', body }), params: { appId: 'app-1' }, locals: { token: 'tok' } });
  };
  it('attaches the chosen memory through the given Agent and reports success', async () => {
    const request = vi.fn().mockResolvedValue({ attachMemoryToApp: { id: 'm1' } });
    const res = await run({ memoryId: 'm1', agentId: 'ag1' }, request) as { form: { message?: { type: string } } };
    expect(request.mock.calls[0][1]).toEqual({ memoryRef: 'm1', appRef: 'app-1', agentRef: 'ag1' });
    expect(res.form.message?.type).toBe('success');
  });
  it('refuses a request with no memory before asking the server', async () => {
    const request = vi.fn();
    await run({ memoryId: '', agentId: 'ag1' }, request);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([['FORBIDDEN', 403], ['AGENT_NOT_INSTALLED', 409], ['MEMORY_ALREADY_APP_SCOPED', 409], ['UNSUPPORTED_MEMORY_CLASS', 400], ['ORGANIZATION_MISMATCH', 400], ['SOMETHING_ELSE', 500]])('answers a %s refusal with fixed copy and status %i, never server text', async (code, status) => {
    const request = vi.fn().mockRejectedValue({ response: { errors: [{ message: 'SECRET server text', extensions: { code } }] } });
    const res = await run({ memoryId: 'm1', agentId: 'ag1' }, request) as { status?: number; form?: { message?: { type: string; text: string } } };
    const text = JSON.stringify(res);
    expect(text).not.toContain('SECRET');
    expect(text).toContain('"error"');
    expect(text).toContain(String(status));
  });
});

describe('readAttachableMemories', () => {
  it('lists only memories of the App\'s own organization that no App holds yet, with their visibility', async () => {
    const request = vi.fn().mockResolvedValue({ memories: { total: 3, items: [
      { id: 'free', urn: 'hrn:mem:e:free', name: 'Free', visibility: 'ORGANIZATION', appId: null, organizationId: 'org-1' },
      { id: 'held', urn: 'hrn:mem:e:held', name: 'Held', visibility: 'ORGANIZATION', appId: 'other-app', organizationId: 'org-1' },
      { id: 'abroad', urn: 'hrn:mem:o:abroad', name: 'Abroad', visibility: 'ORGANIZATION', appId: null, organizationId: 'org-2' },
    ] } });
    expect(await readAttachableMemories({ request } as never, 'org-1')).toEqual([{ id: 'free', urn: 'hrn:mem:e:free', name: 'Free', visibility: 'ORGANIZATION' }]);
    expect(request.mock.calls[0][1]).toMatchObject({ orgId: 'org-1' });
    expect(request.mock.calls[0][0]).toContain('memoryClasses: [personal, private]');
  });
  it('asks for the caller\'s own org-less memories when the App has no organization', async () => {
    const request = vi.fn().mockResolvedValue({ memories: { total: 2, items: [
      { id: 'mine', urn: 'hrn:mem:e:mine', name: 'Mine', visibility: null, appId: null, organizationId: null },
      { id: 'orged', urn: 'hrn:mem:e:orged', name: 'Orged', visibility: null, appId: null, organizationId: 'org-1' },
    ] } });
    expect(await readAttachableMemories({ request } as never, null)).toEqual([{ id: 'mine', urn: 'hrn:mem:e:mine', name: 'Mine', visibility: null }]);
    expect(request.mock.calls[0][1]).toMatchObject({ ownedByMe: true });
  });
  it('reports a failed read instead of claiming there is nothing to add', async () => {
    expect(await readAttachableMemories({ request: vi.fn().mockRejectedValue(new Error('offline')) } as never, 'o')).toBeNull();
  });
});

// portal#1469 (Rico §10 P3-1): the org path above had the only timeout pin.
// The scope read a user-owned App takes needs the same bound — an outage is
// null (unavailable), never a partial or empty list, and the derive keeps
// that meaning instead of folding it into a successful [].
it('bounds an optional scope outage instead of hanging the App page (user-owned)',async()=>{
 vi.useFakeTimers();
 try {
  const pending=readAppMemoryScope({request:vi.fn(()=>new Promise(()=>{}))} as never,'a');
  let settled=false;void pending.then(()=>{settled=true;});
  // a deadline, not a window: still pending a tick before the boundary,
  // resolved to null at it — a late- or early-firing timer fails one leg.
  await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS-1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBeNull();
  // the derive keeps null's meaning — unavailable, not a successful empty
  // list (the gate keeps both assertions in one pin by design)
  expect(appMemoriesFromScope(null,'a')).toBeNull();
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
