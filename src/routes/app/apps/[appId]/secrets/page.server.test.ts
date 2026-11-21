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

beforeEach(() => { request.mockReset(); });

describe('a staged edit (acceptance 1)', () => {
  it('is staged, not saved and not a generic error; the request is remembered with its link', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async (q: string) => { if (q === UPDATE_SECRET_VALUE_MUTATION) throw staged(); });
    const c = jar();
    const r = (await actions.update(ev(c, { request: form({ value: 'new' }) }))) as Record<string, unknown>;
    expect(r).toEqual({ action: 'update', staged: true });
    expect(r).not.toHaveProperty('ok');
    expect(JSON.parse(c.store.get(TRACKED_COOKIE)!)).toEqual([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]);
  });

  it('a refused caller (no request) is a plain refusal and nothing is remembered', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => { throw err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY' }); });
    const c = jar();
    const r = (await actions.update(ev(c, { request: form({ value: 'new' }) }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).not.toHaveProperty('staged');
    expect(c.store.size).toBe(0);
  });

  it('a staged protect toggle and a staged delete are staged too', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => { throw staged(); });
    expect(await actions.protect(ev(jar(), { request: form({ protected: 'false' }) }))).toEqual({ action: 'protect', staged: true });
    expect(await actions.delete(ev(jar()))).toEqual({ action: 'delete', staged: true });
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
    request.mockImplementation(async () => ({ deleteSecret: false }));
    const r = (await actions.delete(ev(jar()))) as { status: number; data: { message: string } };
    expect(r.status).toBe(400);
    expect(r.data.message).toContain('Nothing was deleted');
  });
  it('delete answering true redirects to the list', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(async () => ({ deleteSecret: true }));
    await expect(actions.delete(ev(jar()))).rejects.toMatchObject({ status: 303 });
  });
  it('an unprotected create leaves the protected argument out; a protected one sends true', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async () => ({ createSecret: secret }));
    await actions.create(ev(jar(), { request: form({ name: 'a-key', value: 'v' }) }));
    expect(request.mock.calls.at(-1)![1]).not.toHaveProperty('protected');
    await actions.create(ev(jar(), { request: form({ name: 'a-key', value: 'v', protected: 'on' }) }));
    expect(request.mock.calls.at(-1)![1]).toMatchObject({ protected: true });
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
    expect(d.pending).toEqual([{ requestId: 'r1', secretId: 's1', ceremonyUrl: URL_, state: 'open', operation: 'STORE', expiresAt: open.expiresAt }]);
    expect(c.store.has(TRACKED_COOKIE)).toBe(true);
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
  it('a staged create reads as a create, not as a new value', async () => {
    const { load } = await import('./+page.server');
    const c = jar(JSON.stringify([{ secretId: 'create:app-1:new-key', requestId: 'r1', ceremonyUrl: URL_ }]));
    request.mockImplementation(base('on', open));
    const d = (await load(ev(c))) as { pending: Array<{ operation: string }> };
    expect(d.pending[0].operation).toBe('CREATE');
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

describe('list route', () => {
  it('create: a protected create is staged (no row yet) and remembered under the App and name', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async (q: string) => { if (q === CREATE_SECRET_MUTATION) throw staged(); });
    const c = jar();
    const r = await actions.create(ev(c, { request: form({ name: 'stripe-key', value: 'sk', protected: 'on' }) }));
    expect(r).toEqual({ action: 'create', staged: true, name: 'stripe-key' });
    expect(JSON.parse(c.store.get(TRACKED_COOKIE)!)[0].secretId).toBe('create:app-1:stripe-key');
    expect(request).toHaveBeenCalledWith(CREATE_SECRET_MUTATION, expect.objectContaining({ ownerRef: 'app-1', kind: 'generic', protected: true }));
  });
  it('create rejects a bad name and an empty value before any call', async () => {
    const { actions } = await import('./+page.server');
    const bad = (await actions.create(ev(jar(), { request: form({ name: 'Bad Name', value: 'x' }) }))) as { status: number };
    const empty = (await actions.create(ev(jar(), { request: form({ name: 'ok', value: ' ' }) }))) as { status: number };
    expect([bad.status, empty.status]).toEqual([400, 400]);
    expect(request).not.toHaveBeenCalled();
  });
  it('the list reads only secrets, the signing probe and tracked requests; the detail route exports update, protect, delete, withdraw', async () => {
    const list = await import('./+page.server');
    const detail = await import('./[secretId]/+page.server');
    expect(Object.keys(list.actions).sort()).toEqual(['create', 'withdraw']);
    expect(Object.keys(detail.actions).sort()).toEqual(['delete', 'protect', 'update', 'withdraw']);
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_SECRETS_QUERY) return { secrets: { total: 1, items: [secret] } };
      if (q === SECRET_CHANGE_REQUEST_QUERY) return { secretChangeRequest: null };
    });
    const d = (await list.load(ev(jar()))) as { secrets: { kind: string }; signing: string };
    expect(d.secrets.kind).toBe('ok');
    expect(d.signing).toBe('on');
    expect(DELETE_SECRET_MUTATION && SET_SECRET_PROTECTED_MUTATION).toBeTruthy();
  });
  it('impersonation is read-only', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    const r = (await actions.update({ ...(ev(jar()) as object), locals: { token: 't', impersonation: { id: 'x' } }, request: form({ value: 'v' }) } as never)) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});
