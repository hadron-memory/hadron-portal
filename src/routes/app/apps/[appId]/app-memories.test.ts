import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn() }));
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { gqlClient } from '$lib/server/api';
import { appMemoriesFromScope, withLinkedMemories, readAttachedMemories, attachMemory, detachMemory, APP_ATTACHED_MEMORIES_QUERY, DETACH_MEMORY_FROM_APP_MUTATION, canCreateAppMemory, readAppMemoryScope, readAttachableMemories } from './app-memories';
import type { AppMemoryRow } from './app-memories';
import { notYetInScope } from './attachable-candidates';
it.each(['OWNER','ADMIN','CONTRIBUTOR','READER'])('creation visibility follows the current user org role %s', role => {
 expect(canCreateAppMemory({members:[{role,user:{id:'me'}},{role:'OWNER',user:{id:'other'}}]},'me')).toBe(['OWNER','ADMIN'].includes(role));
});
it('fails closed without a known org membership or signed-in user',()=>{
 expect(canCreateAppMemory(null,'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'other'}}]},'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'me'}}]},null)).toBe(false);
});
// The list is the viewer's whole memory scope (hrn:node:hadronmemory.com:specs:cor:dmo:050:17), one row per memory, whatever put it in scope.
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
  it('attaches the chosen memory and reports success, sending no Agent', async () => {
    const request = vi.fn().mockResolvedValue({ attachMemoryToApp: { id: 'm1' } });
    const res = await run({ memoryId: 'm1' }, request) as { form: { message?: { type: string } } };
    expect(request.mock.calls[0][1]).toEqual({ memoryRef: 'm1', appRef: 'app-1' });
    expect(request.mock.calls[0][0]).not.toContain('agentRef');
    expect(res.form.message?.type).toBe('success');
  });
  it('refuses a request with no memory before asking the server', async () => {
    const request = vi.fn();
    await run({ memoryId: '' }, request);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([['FORBIDDEN', 403], ['UNAUTHENTICATED', 401], ['APP_UNINSTALLED', 409], ['MEMORY_NOT_FOUND', 404], ['UNSUPPORTED_MEMORY_CLASS', 400], ['SOMETHING_ELSE', 500]])('answers a %s refusal with fixed copy and status %i, never server text', async (code, status) => {
    const request = vi.fn().mockRejectedValue({ response: { errors: [{ message: 'SECRET server text', extensions: { code } }] } });
    const res = await run({ memoryId: 'm1' }, request) as { status?: number; form?: { message?: { type: string; text: string } } };
    const text = JSON.stringify(res);
    expect(text).not.toContain('SECRET');
    expect(text).toContain('"error"');
    expect(text).toContain(String(status));
  });
  // portal#2635: the old attach rules are gone. Their codes are not special cases, and nothing says "owner", "renamed" or "limit".
  it.each(['MEMORY_ALREADY_APP_SCOPED', 'ORGANIZATION_MISMATCH', 'AGENT_NOT_INSTALLED'])('does not answer %s with the old copy', async (code) => {
    const request = vi.fn().mockRejectedValue({ response: { errors: [{ message: 'x', extensions: { code } }] } });
    const res = JSON.stringify(await run({ memoryId: 'm1' }, request));
    for (const old of ['already belongs to an App', 'different organization', 'personal and private memories', 'memory you own', 'Install an Agent']) expect(res).not.toContain(old);
    expect(res).toContain('500');
  });
  // Gravitus F1: the remedy for an uninstalled App is reinstalling it, not installing an Agent.
  it('answers APP_UNINSTALLED with its own copy, not the Agent remedy', async () => {
    const res = JSON.stringify(await run({ memoryId: 'm1' }, vi.fn().mockRejectedValue({ response: { errors: [{ message: 'x', extensions: { code: 'APP_UNINSTALLED' } }] } })));
    expect(res).toContain('Reinstall it');
    expect(res).not.toContain('Install an Agent');
  });
  it('says a system memory cannot be attached, and a missing or unreadable memory is one answer', async () => {
    const refuse = async (code: string) => JSON.stringify(await run({ memoryId: 'm1' }, vi.fn().mockRejectedValue({ response: { errors: [{ message: 'x', extensions: { code } }] } })));
    expect(await refuse('UNSUPPORTED_MEMORY_CLASS')).toContain('A system memory cannot be attached to an App.');
    expect(await refuse('MEMORY_NOT_FOUND')).toContain('couldn’t be found');
  });
});

describe('readAttachableMemories', () => {
  const rows = [
    { id: 'owned', urn: 'hrn:mem:e:owned', name: 'Owned', visibility: null },
    { id: 'shared', urn: 'hrn:mem:o:shared', name: 'Shared with me', visibility: 'ORGANIZATION' },
    { id: 'held', urn: 'hrn:mem:e:held', name: 'Linked elsewhere', visibility: null },
  ];
  // portal#2635: the link law (hrn:node:hadronmemory.com:specs:cor:dmo:060:20). Any memory the person can read, except system.
  it('asks for every class but system, with no owner, organization or class-count narrowing', async () => {
    const request = vi.fn().mockResolvedValue({ memories: { total: 3, items: rows } });
    await readAttachableMemories({ request } as never);
    const [doc, vars] = request.mock.calls[0];
    expect(doc).toContain('memoryClasses: [app, group, knowledge, personal, private]');
    expect(doc).not.toContain('system');
    expect(doc).not.toContain('ownedByMe');
    expect(doc).not.toContain('orgRef');
    expect(vars).not.toHaveProperty('ownedByMe');
    expect(vars).not.toHaveProperty('orgRef');
  });
  it('offers memories another person owns, one of another organization and one linked to another App', async () => {
    const request = vi.fn().mockResolvedValue({ memories: { total: 3, items: rows } });
    expect((await readAttachableMemories({ request } as never))?.map(m => m.id)).toEqual(['owned', 'shared', 'held']);
  });
  it('reports a failed read instead of claiming there is nothing to add', async () => {
    expect(await readAttachableMemories({ request: vi.fn().mockRejectedValue(new Error('offline')) } as never)).toBeNull();
  });
});

describe('notYetInScope', () => {
  const c = (id: string) => ({ id, urn: `hrn:mem:e:${id}`, name: id, visibility: null });
  const row = (id: string) => ({ id, urn: `hrn:mem:e:${id}`, name: id, class: 'app', appId: 'a' });
  it('leaves out a memory already in this App\'s scope, since attaching it again does nothing', () => {
    expect(notYetInScope([c('a'), c('b'), c('c')], [row('b')]).map(m => m.id)).toEqual(['a', 'c']);
  });
  it('leaves the list whole when the scope is unavailable; the server decides', () => {
    expect(notYetInScope([c('a')], null).map(m => m.id)).toEqual(['a']);
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

// QA F1: the default memories() list omits a memory reached only through a share, so the picker reads that slice too.
describe('readAttachableMemories, shared-with-me slice', () => {
  it('reads the shared slice as well and joins the two lists, one row per memory', async () => {
    const own = { id: 'own', urn: 'hrn:mem:e:own', name: 'Own', visibility: null };
    const shared = { id: 'sh', urn: 'hrn:mem:u:sh', name: 'Shared', visibility: null };
    const request = vi.fn(async (_doc: string, vars: { sharedWithMe: boolean | null }) => ({ memories: { total: 1, items: vars.sharedWithMe ? [shared, own] : [own] } }));
    const got = await readAttachableMemories({ request } as never);
    expect(request.mock.calls.map(c => c[1].sharedWithMe)).toEqual([null, true]);
    expect(got?.map(m => m.id)).toEqual(['own', 'sh']);
  });
  it('is unavailable when either read fails, never a shorter list', async () => {
    const request = vi.fn(async (_doc: string, vars: { sharedWithMe: boolean | null }) => { if (vars.sharedWithMe) throw new Error('offline'); return { memories: { total: 0, items: [] } }; });
    expect(await readAttachableMemories({ request } as never)).toBeNull();
  });
});

// QA F2 / Gravitus F2: a linked memory is not an appMemoryScope row, so the list reads it from App.attachedMemories.
describe('linked memories in the App list', () => {
  const row = (id: string): AppMemoryRow => ({ id, urn: `hrn:mem:e:${id}`, name: id, class: 'knowledge', appId: null });
  it('adds each linked memory after the scope rows, once', () => {
    expect(withLinkedMemories([row('app')], [row('k'), row('app')])?.map(r => r.id)).toEqual(['app', 'k']);
  });
  it('leaves the scope alone when the link read failed, and stays unavailable when the scope is', () => {
    expect(withLinkedMemories([row('app')], null)?.map(r => r.id)).toEqual(['app']);
    expect(withLinkedMemories(null, [row('k')])).toBeNull();
  });
  it('reads name, URN and class of each link, and is null when the read fails or the App is unreadable', async () => {
    const memory = { id: 'k', urn: 'hrn:mem:e:k', name: 'K', class: 'knowledge' };
    expect(await readAttachedMemories({ request: vi.fn().mockResolvedValue({ app: { attachedMemories: [{ active: true, memory }] } }) } as never, 'a')).toEqual([{ ...memory, appId: null, link: { active: true } }]);
    expect(await readAttachedMemories({ request: vi.fn().mockResolvedValue({ app: null }) } as never, 'a')).toBeNull();
    expect(await readAttachedMemories({ request: vi.fn().mockRejectedValue(new Error('x')) } as never, 'a')).toBeNull();
  });
});

// portal#2674: detach a linked memory, and show an attachment that does not count right now as what it is.
describe('portal#2674: linked memories carry their link', () => {
  const row = (id: string): AppMemoryRow => ({ id, urn: `hrn:mem:e:${id}`, name: id, class: 'knowledge', appId: null });
  const link = (id: string, active = true): AppMemoryRow => ({ ...row(id), link: { active } });
  it('reads whether each link counts right now', () => {
    expect(APP_ATTACHED_MEMORIES_QUERY).toMatch(/attachedMemories\s*{\s*active\b/);
  });
  it('lists an inactive link, marked, rather than leaving it out or showing it plain', () => {
    const rows = withLinkedMemories([row('app')], [link('k', false)])!;
    expect(rows.map(r => r.id)).toEqual(['app', 'k']);
    expect(rows[1].link).toEqual({ active: false });
    expect(rows[0].link).toBeUndefined();
  });
  it('marks a scope row that is also a link, instead of dropping the link', () => {
    const rows = withLinkedMemories([row('k')], [link('k', false)])!;
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toEqual({ active: false });
  });
  it('never offers a linked memory as attachable, active or not', () => {
    const rows = withLinkedMemories([], [link('on'), link('off', false)])!;
    const candidate = (id: string) => ({ id, urn: `hrn:mem:e:${id}`, name: id, visibility: null });
    expect(notYetInScope([candidate('on'), candidate('off'), candidate('free')], rows).map(m => m.id)).toEqual(['free']);
  });
});

describe('detachMemory action', () => {
  const run = (fields: Record<string, string>, request: ReturnType<typeof vi.fn>) => {
    vi.mocked(gqlClient).mockReturnValue({ request } as never);
    const body = new FormData();
    for (const [k, v] of Object.entries({ _kind: 'detachAppMemory', ...fields })) body.set(k, v);
    return detachMemory({ request: new Request('http://x/', { method: 'POST', body }), params: { appId: 'app-1' }, locals: { token: 'tok' } });
  };
  it('detaches the chosen memory with the two refs and reports success', async () => {
    const request = vi.fn().mockResolvedValue({ detachMemoryFromApp: true });
    const res = await run({ memoryId: 'm1' }, request) as { form: { message?: { type: string; text: string } } };
    expect(request.mock.calls[0][0]).toBe(DETACH_MEMORY_FROM_APP_MUTATION);
    expect(request.mock.calls[0][1]).toEqual({ memoryRef: 'm1', appRef: 'app-1' });
    expect(res.form.message?.type).toBe('success');
  });
  it('says the attachment is removed and the memory is not touched (hrn:node:hadronmemory.com:specs:cor:dmo:060:20), and never says deleted', async () => {
    const res = await run({ memoryId: 'm1' }, vi.fn().mockResolvedValue({ detachMemoryFromApp: true })) as { form: { message?: { text: string } } };
    expect(res.form.message?.text).toMatch(/attachment/i);
    expect(res.form.message?.text).not.toMatch(/\blink/i);
    expect(res.form.message?.text).not.toMatch(/delet/i);
  });
  it('refuses a request with no memory before asking the server, and says so', async () => {
    const request = vi.fn();
    const res = await run({ memoryId: '' }, request) as { status: number; data: { form: { message?: { type: string; text: string } } } };
    expect(request).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.data.form.message).toMatchObject({ type: 'error', text: 'Choose a memory to detach and try again.' });
  });
  it.each([['FORBIDDEN', 403], ['UNAUTHENTICATED', 401], ['MEMORY_NOT_FOUND', 404], ['SOMETHING_ELSE', 500]])('answers a %s refusal with fixed copy and status %i, never server text', async (code, status) => {
    const request = vi.fn().mockRejectedValue({ response: { errors: [{ message: 'SECRET server text', extensions: { code } }] } });
    const res = await run({ memoryId: 'm1' }, request) as { status?: number; data?: { form: { message?: { type: string; text: string } } } };
    expect(res.status).toBe(status);
    expect(res.data?.form.message?.type).toBe('error');
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });
  it('names who may detach only as the specs state it, in the FORBIDDEN copy', async () => {
    const res = JSON.stringify(await run({ memoryId: 'm1' }, vi.fn().mockRejectedValue({ response: { errors: [{ message: 'x', extensions: { code: 'FORBIDDEN' } }] } })));
    expect(res).toContain('made the attachment');
    expect(res).toContain('strict owner');
    expect(res).not.toMatch(/\blink/i);
    expect(res).toContain('manages this App');
  });
});
