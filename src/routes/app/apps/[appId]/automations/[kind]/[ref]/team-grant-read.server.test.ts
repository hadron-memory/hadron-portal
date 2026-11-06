/**
 * portal#1650, LOCAL P2-2 — the section's own re-read after a write. The page
 * must outlive a failed re-read, so this is an endpoint and not invalidateAll
 * (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
 * It answers exactly what the page's loader would: a refusal is `hidden`, a
 * failed read is `unavailable`, and both travel in a 200.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const row = (over: Record<string, unknown> = {}) => ({ id: 'g1', triggerKind: 'SCHEDULE', triggerId: 'sch-1', grantedBy: 'u1', createdAt: '2026-11-01T10:00:00.000Z', revokedAt: null, revokedBy: null, ...over });
const ended = row({ id: 'g0', revokedAt: '2026-11-02T10:00:00.000Z', revokedBy: 'u1' });
const list = (items: unknown[]) => ({ automationTeamSnapshotGrants: { items, total: items.length, hasMore: false } });
const fails = (code: string) => { throw { response: { errors: [{ message: code, extensions: { code } }] } }; };

async function read(token: string | undefined, kind = 'schedule', search = '') {
  const { GET } = await import('./team-grant/+server');
  return GET({ locals: { token }, params: { appId: 'app-1', kind, ref: 'sch-1' }, url: new URL(`http://localhost/x${search}`) } as never);
}

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  request.mockImplementation(async (q: string) => (/\buser\(/.test(q) ? { user: null } : list([ended, row()])));
});

describe('GET team-grant', () => {
  it('answers what the page would, uncached', async () => {
    const r = await read('tok');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ status: 'ready', live: { id: 'g1' }, ended: null });
  });
  it('shows ended grants only when asked', async () => {
    expect(await (await read('tok', 'schedule', '?ended=1')).json()).toMatchObject({ ended: [{ id: 'g0' }] });
  });
  it('a refused list is hidden, in a 200', async () => {
    request.mockImplementation(async () => fails('FORBIDDEN'));
    const r = await read('tok');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'hidden' });
  });
  it('a failed list is unavailable, in a 200', async () => {
    request.mockImplementation(async () => fails('INTERNAL_SERVER_ERROR'));
    const r = await read('tok');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'unavailable' });
  });
  it('no session is a 401 and asks the server nothing', async () => {
    expect((await read(undefined)).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it('a kind that is not one is a 404 and asks the server nothing', async () => {
    expect((await read('tok', 'nonsense')).status).toBe(404);
    expect(request).not.toHaveBeenCalled();
  });
  it('a manual run has nothing to read', async () => {
    expect(await (await read('tok', 'manual')).json()).toEqual({ status: 'hidden' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('parseTeamGrant', () => {
  const person = { name: 'Ana', urn: 'hrn:user:ana' };
  const good = { id: 'g1', createdAt: '2026-11-01T10:00:00.000Z', revokedAt: null, givenBy: person, endedBy: null };
  const parse = async (v: unknown) => (await import('$lib/automation/team-grant')).parseTeamGrant(v);
  it.each([
    [{ status: 'hidden' }], [{ status: 'unavailable' }],
    [{ status: 'ready', live: null, ended: null }],
    [{ status: 'ready', live: good, ended: [] }],
    [{ status: 'ready', live: { ...good, givenBy: null }, ended: [{ ...good, revokedAt: '2026-11-02T10:00:00.000Z' }] }],
  ])('takes %j', async (v) => { expect(await parse(v)).toEqual(v); });
  it.each([
    [null], ['ready'], [{}], [{ status: 'off' }],
    [{ status: 'ready' }],
    [{ status: 'ready', live: 'yes', ended: null }],
    [{ status: 'ready', live: null, ended: 'no' }],
    [{ status: 'ready', live: { ...good, id: 1 }, ended: null }],
    [{ status: 'ready', live: { ...good, createdAt: null }, ended: null }],
    [{ status: 'ready', live: { ...good, revokedAt: 5 }, ended: null }],
    [{ status: 'ready', live: { ...good, givenBy: { name: 2, urn: null } }, ended: null }],
    [{ status: 'ready', live: { ...good, endedBy: { name: 'x', urn: 3 } }, ended: null }],
    [{ status: 'ready', live: null, ended: [{ ...good, id: null }] }],
  ])('refuses %j', async (v) => { expect(await parse(v)).toBeNull(); });
});
