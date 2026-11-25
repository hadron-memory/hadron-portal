/**
 * portal#2380 — a protected App secret's change is STAGED: the value is not saved, a request
 * waits for the person's passkey signature, and the portal only links to the server's page.
 * Red on main: there was no secrets surface, and a staged refusal read as a generic error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import {
  APP_SECRETS_QUERY, CREATE_SECRET_MUTATION, DELETE_SECRET_MUTATION, SECRET_CHANGE_REQUEST_QUERY, SECRET_QUERY,
  SET_SECRET_PROTECTED_MUTATION, UPDATE_SECRET_VALUE_MUTATION, WITHDRAW_CHANGE_REQUEST_MUTATION,
} from '$lib/server/secrets';
import { TRACKED_COOKIE } from '$lib/secrets/tracked';
import { env } from '$env/dynamic/public';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', protected: true, currentVersion: 2, metadata: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const URL_ = 'https://hadron.example/secret-changes/r1';
const err = (extensions: Record<string, unknown>, message = 'x') => ({ response: { errors: [{ message, extensions }] }, request: { query: '', variables: {} } });
const staged = () => err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: URL_ });

function jar(initial?: string) {
  const store = new Map<string, string>(initial ? [[TRACKED_COOKIE, initial]] : []);
  return { store, get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v), delete: (k: string) => void store.delete(k) };
}
const form = (o: Record<string, string>) => ({ formData: async () => new URLSearchParams(o) as unknown as FormData });
const ev = (cookies: ReturnType<typeof jar>, extra: object = {}) => ({
  params: { appId: 'app-1', secretId: 's1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation: null }, cookies, ...extra,
}) as never;

/** An action first reads the App and the secret (the same ownership read the load makes); `impl` answers the rest. */
const owned = (impl: (q: string, v?: unknown) => unknown) => async (q: string, v?: unknown) => (q === AGENT_TASKS_APP_QUERY ? { app } : q === SECRET_QUERY ? { secret } : impl(q, v));
const confirmed = form({ confirm: 'yes' });

beforeEach(() => { request.mockReset(); env.PUBLIC_SERVER_URL = 'https://hadron.example'; });

describe('a staged edit (acceptance 1)', () => {
  it('is staged, not saved and not a generic error; the request is remembered without any URL', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned((q) => { if (q === UPDATE_SECRET_VALUE_MUTATION) throw staged(); }));
    const c = jar();
    const r = (await actions.update(ev(c, { request: form({ value: 'new' }) }))) as Record<string, unknown>;
    expect(r).toEqual({ action: 'update', staged: true });
    expect(r).not.toHaveProperty('ok');
    expect(c.store.get(TRACKED_COOKIE)).toBe(JSON.stringify([{ secretId: 's1', requestId: 'r1' }]));
  });

  it('a refused caller (no request) is a plain refusal and nothing is remembered', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => { throw err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY' }); }));
    const c = jar();
    const r = (await actions.update(ev(c, { request: form({ value: 'new' }) }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).not.toHaveProperty('staged');
    expect(c.store.size).toBe(0);
  });

  it('a staged protect toggle and a staged delete are staged too', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => { throw staged(); }));
    expect(await actions.protect(ev(jar(), { request: form({ protected: 'false' }) }))).toEqual({ action: 'protect', staged: true });
    expect(await actions.delete(ev(jar(), { request: confirmed }))).toEqual({ action: 'delete', staged: true });
  });
});

describe('a false Boolean payload is not a success', () => {
  it('withdraw answering false says nothing was withdrawn and keeps the request tracked', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => ({ withdrawSecretChangeRequest: false }));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    const r = (await actions.withdraw(ev(c, { request: form({ requestId: 'r1' }) }))) as { status: number; data: { message: string } };
    expect(r.status).toBe(400);
    expect(r.data.message).toContain('Nothing was withdrawn');
    expect(c.store.has(TRACKED_COOKIE)).toBe(true);
  });
  it('delete answering false says nothing was deleted instead of redirecting as if it were gone', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => ({ deleteSecret: false })));
    const r = (await actions.delete(ev(jar(), { request: confirmed }))) as { status: number; data: { message: string } };
    expect(r.status).toBe(400);
    expect(r.data.message).toContain('Nothing was deleted');
  });
  it('delete answering true redirects to the App\'s Secrets section', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => ({ deleteSecret: true })));
    await expect(actions.delete(ev(jar(), { request: confirmed }))).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1?tab=settings&section=secrets' });
  });
});

describe('withdraw (acceptance 2)', () => {
  it('sends once, then the request is forgotten', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => ({ withdrawSecretChangeRequest: true }));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    expect(await actions.withdraw(ev(c, { request: form({ requestId: 'r1' }) }))).toEqual({ action: 'withdraw', ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(WITHDRAW_CHANGE_REQUEST_MUTATION, { id: 'r1' });
    expect(c.store.has(TRACKED_COOKIE)).toBe(false);
  });
  it('a refused withdraw keeps the request and says so', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => { throw err({ code: 'FORBIDDEN' }, 'Not yours.'); });
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    const r = (await actions.withdraw(ev(c, { request: form({ requestId: 'r1' }) }))) as { status: number };
    expect(r.status).toBe(400);
    expect(c.store.has(TRACKED_COOKIE)).toBe(true);
  });
});

describe('the secret page load', () => {
  const base = (signing: 'on' | 'off', cr: unknown) => async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === SECRET_QUERY) return { secret };
    if (q === SECRET_CHANGE_REQUEST_QUERY) {
      if (signing === 'off') throw err({ code: 'GRAPHQL_VALIDATION_FAILED' });
      return { secretChangeRequest: cr };
    }
  };
  const open = { id: 'r1', state: 'open', operation: 'STORE', createdAt: '2026-11-21T00:00:00Z', expiresAt: '2026-11-21T01:00:00Z' };

  it('shows an open request with its link, re-read on revisit, and keeps it', async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(base('on', open));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    const d = (await load(ev(c))) as { signing: string; pending: Array<{ state: string; ceremonyUrl: string }> };
    expect(d.signing).toBe('on');
    expect(d.pending).toEqual([{ requestId: 'r1', secretId: 's1', createName: null, ceremonyUrl: URL_, state: 'open', operation: 'STORE', expiresAt: open.expiresAt }]);
    expect(c.store.has(TRACKED_COOKIE)).toBe(true);
  });
  it('a cookie edited to another host is ignored: the row keeps the rebuilt link (portal#2417)', async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(base('on', open));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: 'https://evil.example/secret-changes/ATTACK' }]));
    const d = (await load(ev(c))) as { pending: Array<{ ceremonyUrl: string }> };
    expect(d.pending).toEqual([{ requestId: 'r1', secretId: 's1', createName: null, ceremonyUrl: URL_, state: 'open', operation: 'STORE', expiresAt: open.expiresAt }]);
  });
  it('with no configured origin the row still shows, with no link, never a guess (portal#2417)', async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(base('on', open));
    env.PUBLIC_SERVER_URL = '';
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    const d = (await load(ev(c))) as { pending: Array<{ ceremonyUrl: string | null }> };
    expect(d.pending).toEqual([{ requestId: 'r1', secretId: 's1', createName: null, ceremonyUrl: null, state: 'open', operation: 'STORE', expiresAt: open.expiresAt }]);
  });
  it('an ended request shows once; one the server does not show the viewer is dropped', async () => {
    const { load } = await import('./[secretId]/+page.server');
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    request.mockImplementation(base('on', { ...open, state: 'expired' }));
    expect(((await load(ev(c))) as { pending: unknown[] }).pending).toHaveLength(1);
    expect(c.store.has(TRACKED_COOKIE)).toBe(false);
    const c2 = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    request.mockImplementation(base('on', null));
    expect(((await load(ev(c2))) as { pending: unknown[] }).pending).toEqual([]);
    expect(c2.store.has(TRACKED_COOKIE)).toBe(false);
  });
  it('an impersonated visit never erases the admin\'s tracked requests (the server answers null to a non-requester)', async () => {
    const { load } = await import('./[secretId]/+page.server');
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    request.mockImplementation(base('on', null));
    const d = (await load(ev(c, { locals: { token: 'tok', user: { id: 'u2' }, impersonation: { by: 'admin' } } }))) as { pending: unknown[] };
    expect(d.pending).toEqual([]);
    expect(JSON.parse(c.store.get(TRACKED_COOKIE)!)).toHaveLength(1);
  });
  it('a server without signing: the probe reads off, so the toggle is hidden (acceptance 3)', async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(base('off', null));
    expect(((await load(ev(jar()))) as { signing: string }).signing).toBe('off');
  });
  it("another App's secret reads as missing (404)", async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { secret: { ...secret, ownerId: 'app-2' } }));
    await expect(load(ev(jar()))).rejects.toMatchObject({ status: 404 });
  });
});

describe('the detail route', () => {
  it('impersonation is read-only', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    const r = (await actions.update({ ...(ev(jar()) as object), locals: { token: 't', impersonation: { id: 'x' } }, request: form({ value: 'v' }) } as never)) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('portal#2436 polish', () => {
  const open = { id: 'r1', state: 'open', operation: 'STORE', createdAt: '2026-11-21T00:00:00Z', expiresAt: '2026-11-21T01:00:00Z' };
  const reads = (cr: unknown) => async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === APP_SECRETS_QUERY) return { secrets: { total: 0, items: [] } };
    if (q === SECRET_QUERY) return { secret };
    if (q === SECRET_CHANGE_REQUEST_QUERY) return { secretChangeRequest: cr };
  };

  it.each(['completed', 'declined', 'expired', 'withdrawn', 'stale'])('item 2: %s shows once, then is dropped', async (state) => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(reads({ ...open, state }));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    expect(((await load(ev(c))) as { pending: unknown[] }).pending).toHaveLength(1);
    expect(c.store.has(TRACKED_COOKIE)).toBe(false);
  });
  it('item 2: a state this code does not know is shown and kept, never dropped unseen', async () => {
    const { load } = await import('./[secretId]/+page.server');
    request.mockImplementation(reads({ ...open, state: 'quarantined' }));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    const d = (await load(ev(c))) as { pending: Array<{ state: string }> };
    expect(d.pending.map((p) => p.state)).toEqual(['quarantined']);
    expect(c.store.has(TRACKED_COOKIE)).toBe(true);
  });

  it("item 3: an update, protect or delete posted at another App's secret is a 404 and writes nothing", async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : q === SECRET_QUERY ? { secret: { ...secret, ownerId: 'app-2' } } : (() => { throw new Error(`unexpected write ${q}`); })()));
    for (const [name, r] of [
      ['update', await actions.update(ev(jar(), { request: form({ value: 'v' }) }))],
      ['protect', await actions.protect(ev(jar(), { request: form({ protected: 'true' }) }))],
      ['delete', await actions.delete(ev(jar(), { request: confirmed }))],
    ] as const) expect(r, name).toMatchObject({ status: 404 });
    expect(request.mock.calls.map((c) => c[0])).not.toContain(UPDATE_SECRET_VALUE_MUTATION);
    expect(request.mock.calls.map((c) => c[0])).not.toContain(DELETE_SECRET_MUTATION);
    expect(request.mock.calls.map((c) => c[0])).not.toContain(SET_SECRET_PROTECTED_MUTATION);
  });
  it('item 3: an ownership read that fails is not a license to write', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw new Error('down'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = (await actions.update(ev(jar(), { request: form({ value: 'v' }) }))) as { status: number };
    expect(r.status).toBe(400);
    expect(request.mock.calls.map((c) => c[0])).not.toContain(UPDATE_SECRET_VALUE_MUTATION);
  });

  it('item 4: Delete without a confirmation only asks; nothing is read or written', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => { throw new Error('no call expected'); });
    expect(await actions.delete(ev(jar(), { request: form({}) }))).toEqual({ action: 'delete', confirm: true });
    expect(await actions.delete(ev(jar(), { request: form({ confirm: 'no' }) }))).toEqual({ action: 'delete', confirm: true });
    expect(request).not.toHaveBeenCalled();
  });
});
