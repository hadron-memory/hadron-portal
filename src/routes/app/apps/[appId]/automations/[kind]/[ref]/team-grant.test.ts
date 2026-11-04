/**
 * portal#1650 — the automation's team snapshot grant, on the server side of its
 * page. The list covers the whole App, so the page finds its own automation in
 * it. A list the server refuses hides the section; a list that fails is not
 * "off". Give and Stop name the trigger from the URL, never from the form.
 *
 * Reads are routed by the field they ask for and answered in the producer's
 * shape (resolvers.runTeamSnapshot.ts at hadron-server ecdde802).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/agent-tasks', async (orig) => ({
  ...(await orig<typeof import('$lib/server/agent-tasks')>()),
  loadTasksApp: vi.fn().mockResolvedValue({ id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null }),
}));
vi.mock('$lib/server/automation-approval', async (orig) => ({
  ...(await orig<typeof import('$lib/server/automation-approval')>()),
  loadAutomationApproval: vi.fn().mockResolvedValue({ state: 'ADOPTED', hash: 'h', depth: {}, summary: { name: 'Nightly' } }),
}));

const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1', appId: 'app-1', triggerKind: 'SCHEDULE', triggerId: 'sch-1', grantedBy: 'u-ana',
  createdAt: '2026-11-01T10:00:00.000Z', revokedAt: null, revokedBy: null, ...over,
});
const USERS: Record<string, unknown> = {
  'u-ana': { id: 'u-ana', name: 'Ana', handle: 'ana', urn: 'hrn:user:ana' },
  'u-bo': { id: 'u-bo', name: null, handle: 'bo', urn: 'hrn:user:bo' },
};
const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });
const isList = (q: string) => /automationTeamSnapshotGrants\(/.test(q);
const isGive = (q: string) => /setAutomationTeamSnapshotGrant\(/.test(q);
const isStop = (q: string) => /revokeAutomationTeamSnapshotGrant\(/.test(q);
const calls = (test: (q: string) => boolean) => request.mock.calls.filter((c) => test(c[0] as string));

/** Answers as the server does: the live rows, or every row with includeRevoked, in pages. */
function serve(rows: Record<string, unknown>[], users: Record<string, unknown> = USERS) {
  request.mockImplementation(async (q: string, vars: Record<string, unknown> = {}) => {
    if (isList(q)) {
      const all = vars.includeRevoked ? rows : rows.filter((r) => r.revokedAt === null);
      const offset = Number(vars.offset ?? 0);
      const items = all.slice(offset, offset + Math.min(200, Number(vars.limit ?? 20)));
      return { automationTeamSnapshotGrants: { items, total: all.length, hasMore: offset + items.length < all.length } };
    }
    if (isGive(q)) return { setAutomationTeamSnapshotGrant: grant() };
    if (isStop(q)) return { revokeAutomationTeamSnapshotGrant: grant({ revokedAt: '2026-11-02T10:00:00.000Z', revokedBy: 'u-ana' }) };
    if (/\buser\(/.test(q)) return { user: users[String(vars.ref)] ?? null };
    if (/\bagentSchedules\(/.test(q)) return { agentSchedules: { total: 0, items: [] } }; // portal#1701: the schedule section's read
    throw new Error(`unrouted read: ${q}`);
  });
}

/**
 * LOCAL P2-3: the live-only list shrinks under the offset, so a row that was
 * live throughout can fall behind it. Another manager ends the 200 older rows
 * between page 1 and page 2. The history is the same 201 rows either side.
 */
function serveShrinkingLiveList(others: Record<string, unknown>[], target: Record<string, unknown>) {
  serve([...others, target]);
  const history = request.getMockImplementation()!;
  request.mockImplementation(async (q: string, vars: Record<string, unknown> = {}) => {
    if (!isList(q) || vars.includeRevoked) return history(q, vars);
    return { automationTeamSnapshotGrants: Number(vars.offset ?? 0) === 0
      ? { items: others, total: others.length + 1, hasMore: true }
      : { items: [], total: 1, hasMore: false } };
  });
}
/** A list that ends before the count it claims: what came back is not the whole list. */
function serveShortOf(total: number, rows: Record<string, unknown>[]) {
  serve(rows);
  const rest = request.getMockImplementation()!;
  request.mockImplementation(async (q: string, vars: Record<string, unknown> = {}) => {
    if (!isList(q)) return rest(q, vars);
    return { automationTeamSnapshotGrants: { items: Number(vars.offset ?? 0) === 0 ? rows : [], total, hasMore: false } };
  });
}
const OTHERS = Array.from({ length: 200 }, (_, i) => grant({ id: `o${i}`, triggerId: `other-${i}` }));

const locals = { token: 'tok', user: { id: 'u1' }, impersonation: null };
type TeamGrant = { status: string; live?: Record<string, unknown> | null; ended?: Record<string, unknown>[] | null };
async function teamGrant(kind = 'schedule', search = '') {
  const { load } = await import('./+page.server');
  const r = (await load({ params: { appId: 'app-1', kind, ref: 'sch-1' }, locals, url: new URL(`http://localhost/x${search}`) } as never)) as { teamGrant: TeamGrant; approval: unknown };
  return r;
}
async function act(name: string, kind = 'schedule', fields: Record<string, string> = {}) {
  const { actions } = await import('./+page.server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const action = (actions as Record<string, ((e: never) => Promise<unknown>) | undefined>)[name];
  expect(action, `action ${name}`).toBeTypeOf('function');
  return (await action!({ request: new Request('http://localhost/x', { method: 'POST', body }), params: { appId: 'app-1', kind, ref: 'sch-1' }, locals } as never)) as { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
}

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('reading the grant', () => {
  it('finds this automation in the App-wide list, and says who gave it', async () => {
    serve([grant({ id: 'other', triggerId: 'sch-2' }), grant({ id: 'wrong-kind', triggerKind: 'WEBHOOK' }), grant()]);
    const { teamGrant: g } = await teamGrant();
    expect(g.status).toBe('ready');
    expect(g.live).toMatchObject({ id: 'g1', createdAt: '2026-11-01T10:00:00.000Z', givenBy: { name: 'Ana', urn: 'hrn:user:ana' } });
    expect(g.ended).toBeNull();
    expect(calls(isList)[0][1]).toMatchObject({ appRef: 'app-1', includeRevoked: true });
  });

  it('no grant for this automation is a known "not given", from a whole list', async () => {
    serve([grant({ id: 'other', triggerId: 'sch-2' })]);
    expect((await teamGrant()).teamGrant).toEqual({ status: 'ready', live: null, ended: null });
  });

  it('reads past the first page: a grant on a later page is not "not given"', async () => {
    const others = Array.from({ length: 205 }, (_, i) => grant({ id: `o${i}`, triggerId: `sch-x${i}` }));
    serve([...others, grant()]);
    const { teamGrant: g } = await teamGrant();
    expect(g.live).toMatchObject({ id: 'g1' });
    expect(calls(isList).length).toBeGreaterThan(1);
  });

  it('a grant live throughout stays given when other grants end between pages (LOCAL P2-3)', async () => {
    serveShrinkingLiveList(OTHERS, grant({ id: 'g-live' }));
    const { teamGrant: tg } = await teamGrant();
    expect(tg.status).toBe('ready');
    expect(tg.live).toMatchObject({ id: 'g-live' });
  });

  it('a list that ends before its own count is never "not given", whatever was read of it', async () => {
    serveShortOf(5, [grant({ id: 'o', triggerId: 'other' })]);
    const { teamGrant: tg } = await teamGrant();
    expect(tg).toEqual({ status: 'unavailable' });
  });

  it('a list that repeats a page is never "not given", and the read stops', async () => {
    serve([grant({ id: 'o', triggerId: 'other' })]);
    request.mockImplementation(async (q: string) => {
      if (isList(q)) return { automationTeamSnapshotGrants: { items: [grant({ id: 'o', triggerId: 'other' })], total: 2, hasMore: true } };
      return { user: null };
    });
    const { teamGrant: tg } = await teamGrant();
    expect(tg).toEqual({ status: 'unavailable' });
    expect(calls(isList).length).toBeLessThanOrEqual(6);
  });

  it('a read that came up short is tried again, and a whole one is believed', async () => {
    serve([grant({ id: 'g-live' })]);
    const whole = request.getMockImplementation()!;
    let short = true;
    request.mockImplementation(async (q: string, vars: Record<string, unknown> = {}) => {
      if (isList(q) && short) { short = false; return { automationTeamSnapshotGrants: { items: [], total: 1, hasMore: false } }; }
      return whole(q, vars);
    });
    const { teamGrant: tg } = await teamGrant();
    expect(tg.live).toMatchObject({ id: 'g-live' });
  });

  it('the ended rows it reads to stay complete are not shown or asked about until asked for', async () => {
    serve([grant({ id: 'g0', grantedBy: 'u-bo', revokedAt: '2026-10-20T10:00:00.000Z', revokedBy: 'u-bo' })]);
    const { teamGrant: tg } = await teamGrant();
    expect(tg).toEqual({ status: 'ready', live: null, ended: null });
    expect(calls((q) => /\buser\(/.test(q))).toHaveLength(0);
  });

  it('FORBIDDEN hides the section and asks nothing about people', async () => {
    request.mockImplementation(async (q: string) => { if (isList(q)) throw gqlError('FORBIDDEN'); throw new Error(`unexpected: ${q}`); });
    expect((await teamGrant()).teamGrant).toEqual({ status: 'hidden' });
    expect(calls(isList)).toHaveLength(1);
    expect(calls((q) => /\buser\(/.test(q))).toHaveLength(0);
  });

  it('any other failed read is unavailable, never "not given", and the page still loads', async () => {
    request.mockImplementation(async () => { throw gqlError('INTERNAL_SERVER_ERROR'); });
    const r = await teamGrant();
    expect(r.teamGrant).toEqual({ status: 'unavailable' });
    expect(r.approval).toMatchObject({ state: 'ADOPTED' });
  });

  it('a manual run can never hold it: no read, no section', async () => {
    serve([]);
    expect((await teamGrant('manual')).teamGrant).toEqual({ status: 'hidden' });
    expect(request).not.toHaveBeenCalled();
  });

  it('?ended=1 asks for ended grants and lists only this automation\'s', async () => {
    serve([
      grant({ id: 'g0', revokedAt: '2026-10-20T10:00:00.000Z', revokedBy: 'u-bo' }),
      grant({ id: 'other', triggerId: 'sch-2', revokedAt: '2026-10-21T10:00:00.000Z', revokedBy: 'u-bo' }),
      grant(),
    ]);
    const { teamGrant: g } = await teamGrant('schedule', '?ended=1');
    expect(calls(isList)[0][1]).toMatchObject({ includeRevoked: true });
    expect(g.live).toMatchObject({ id: 'g1' });
    expect(g.ended).toEqual([expect.objectContaining({ id: 'g0', revokedAt: '2026-10-20T10:00:00.000Z', endedBy: { name: 'bo', urn: 'hrn:user:bo' } })]);
  });

  it('a person the viewer may not read is null, not an id or an empty chip', async () => {
    serve([grant({ grantedBy: 'u-stranger' })]);
    expect((await teamGrant()).teamGrant.live).toMatchObject({ givenBy: null });
  });

  it('asks about each person once', async () => {
    serve([grant(), grant({ id: 'g0', revokedAt: '2026-10-20T10:00:00.000Z', revokedBy: 'u-ana' })]);
    await teamGrant('schedule', '?ended=1');
    expect(calls((q) => /\buser\(/.test(q))).toHaveLength(1);
  });
});

describe('Give', () => {
  it('names the trigger from the URL, whatever the form posted', async () => {
    serve([]);
    const r = await act('give', 'webhook', { triggerId: 'evil', triggerKind: 'SCHEDULE', appRef: 'other-app' });
    expect(r).toEqual({ teamGrant: 'given' });
    expect(calls(isGive)[0][1]).toEqual({ appRef: 'app-1', triggerKind: 'WEBHOOK', triggerId: 'sch-1' });
  });

  it('a refusal is the server\'s own words, sent once', async () => {
    request.mockImplementation(async () => { throw gqlError('FORBIDDEN', 'Only a person can give this.'); });
    const r = await act('give');
    expect(r.status).toBe(403);
    expect(r.data).toEqual({ teamGrantRefused: true, teamGrantMessage: 'Only a person can give this.' });
    expect(calls(isGive)).toHaveLength(1);
  });

  it('any other failure stays a failure', async () => {
    request.mockImplementation(async () => { throw gqlError('INTERNAL_SERVER_ERROR'); });
    await expect(act('give')).rejects.toMatchObject({ response: expect.anything() });
  });

  it('a manual trigger is a 404 and asks the server nothing', async () => {
    await expect(act('give', 'manual')).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Stop', () => {
  it('ends this automation\'s live grant, found again on the server, never an id from the form', async () => {
    serve([grant({ id: 'other', triggerId: 'sch-2' }), grant({ id: 'g7' })]);
    const r = await act('stop', 'schedule', { id: 'other' });
    expect(r).toEqual({ teamGrant: 'stopped' });
    expect(calls(isStop).map((c) => c[1])).toEqual([{ id: 'g7' }]);
  });

  it('the history it now reads is not a list of things to end: an ended grant is passed over for the live one', async () => {
    serve([grant({ id: 'g-old', revokedAt: '2026-10-20T10:00:00.000Z', revokedBy: 'u-ana' }), grant({ id: 'g-new' })]);
    expect(await act('stop')).toEqual({ teamGrant: 'stopped' });
    expect(calls(isStop).map((c) => c[1])).toEqual([{ id: 'g-new' }]);
  });

  it('finds a grant live throughout when other grants end between pages (LOCAL P2-3)', async () => {
    serveShrinkingLiveList(OTHERS, grant({ id: 'g-live' }));
    expect(await act('stop')).toEqual({ teamGrant: 'stopped' });
    expect(calls(isStop).map((c) => c[1])).toEqual([{ id: 'g-live' }]);
  });

  it('an incomplete read never reports "stopped": it fails and ends nothing', async () => {
    serveShortOf(5, [grant({ id: 'o', triggerId: 'other' })]);
    await expect(act('stop')).rejects.toThrow();
    expect(calls(isStop)).toHaveLength(0);
  });

  it('with nothing live there is nothing to end: no mutation, and the page re-reads', async () => {
    serve([grant({ id: 'other', triggerId: 'sch-2' })]);
    expect(await act('stop')).toEqual({ teamGrant: 'stopped' });
    expect(calls(isStop)).toHaveLength(0);
  });

  it('a refused list or mutation is the server\'s own words', async () => {
    request.mockImplementation(async (q: string) => {
      if (isList(q)) return { automationTeamSnapshotGrants: { items: [grant()], total: 1, hasMore: false } };
      throw gqlError('FORBIDDEN', 'Not yours to stop.');
    });
    const r = await act('stop');
    expect(r.status).toBe(403);
    expect(r.data).toEqual({ teamGrantRefused: true, teamGrantMessage: 'Not yours to stop.' });
  });

  it('a manual trigger is a 404 and asks the server nothing', async () => {
    await expect(act('stop', 'manual')).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});
