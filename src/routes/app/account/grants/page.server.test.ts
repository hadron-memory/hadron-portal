/**
 * hadron-portal#2134 — /app/account/grants: a person's own grants across Apps.
 * Binding display conditions (gate comment on #2134):
 *  1/2 show what the server returns, no derived state label;
 *  3   impersonation must never read as "you have no grants" (and is never queried);
 *  4   a grant in an App the person can't open is kept, not dropped.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn(() => ({ request: mockRequest })) }));

beforeEach(() => mockRequest.mockReset());

const grant = (id: string, appId: string, over: Record<string, unknown> = {}) => ({
  id, appId, action: 'node.read', holderKind: 'USER', holderId: 'u1', values: null, reason: 'r',
  startsAt: null, expiresAt: null, maxUses: null, useCount: 0, createdAt: '2026-01-01T00:00:00Z',
  activatedAt: null, revokedAt: null, holderDepartedAt: null, allows: false,
  signatureStatus: { state: 'CURRENT', signatures: [] }, ...over,
});

async function load(locals: Record<string, unknown>) {
  const mod = await import('./+page.server');
  return (await mod.load({ locals } as never)) as Record<string, any>;
}

function serve(all: ReturnType<typeof grant>[], apps: Record<string, unknown>) {
  mockRequest.mockImplementation(async (doc: string, vars: any) => {
    if (doc.includes('myGrants')) {
      const o = vars.offset ?? 0;
      return { myGrants: { items: all.slice(o, o + vars.limit), total: all.length } };
    }
    if (doc.includes('app(ref')) {
      const a = apps[vars.ref];
      if (a instanceof Error) throw a;
      return { app: a ?? null };
    }
    throw new Error('unexpected ' + doc);
  });
}

describe('my grants loader', () => {
  it('returns rows as the server gave them, newest first order kept, no state field', async () => {
    serve([grant('g1', 'a1', { allows: true }), grant('g2', 'a1')], { a1: { id: 'a1', name: 'Alpha', urn: 'hrn:app:x:alpha' } });
    const d = await load({ token: 't', impersonation: null });
    expect(d.unavailable).toBe(false);
    expect(d.grants.map((g: any) => g.id)).toEqual(['g1', 'g2']);
    expect(d.grants[0].allows).toBe(true);
    expect(d.grants[0].app).toEqual({ id: 'a1', name: 'Alpha', urn: 'hrn:app:x:alpha' });
    for (const g of d.grants) expect(Object.keys(g)).not.toContain('state');
  });

  it('keeps a grant whose App cannot be opened (null or refused), app = null', async () => {
    serve([grant('g1', 'a1'), grant('g2', 'a2')], { a1: null, a2: new Error('FORBIDDEN') });
    const d = await load({ token: 't', impersonation: null });
    expect(d.grants.map((g: any) => g.id)).toEqual(['g1', 'g2']);
    expect(d.grants.every((g: any) => g.app === null)).toBe(true);
    expect(d.grants[0].appId).toBe('a1');
  });

  it('follows every page', async () => {
    const all = Array.from({ length: 450 }, (_, i) => grant('g' + i, 'a1'));
    serve(all, { a1: { id: 'a1', name: 'A', urn: 'hrn:app:x:a' } });
    const d = await load({ token: 't', impersonation: null });
    expect(d.grants).toHaveLength(450);
  });

  it('under impersonation: unavailable, no empty list, no myGrants call', async () => {
    const d = await load({ token: 't', impersonation: { sessionId: 's', actorUserId: 'admin', orgId: 'o', expiresAt: 1 } });
    expect(d.unavailable).toBe(true);
    expect(d.grants).toEqual([]);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a refused myGrants read is an error, never an empty list', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    await expect(load({ token: 't', impersonation: null })).rejects.toMatchObject({ status: 503 });
  });

  it('no token: unavailable, nothing queried', async () => {
    const d = await load({ token: null, impersonation: null });
    expect(d.unavailable).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
