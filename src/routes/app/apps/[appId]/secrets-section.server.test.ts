/**
 * portal#2380 — the Secrets section of the App's Settings: its reads (`loadSecretsPanel`) and its two writes
 * (`createSecret`, `withdrawSecret` on the App page). A protected create is STAGED, the value is not saved, and
 * an impersonated session writes nothing. Moved here from the retired /secrets list route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APP_SECRETS_QUERY, CREATE_SECRET_MUTATION, SECRET_CHANGE_REQUEST_QUERY, WITHDRAW_CHANGE_REQUEST_MUTATION } from '$lib/server/secrets';
import { TRACKED_COOKIE } from '$lib/secrets/tracked';
import { env } from '$env/dynamic/public';
import { loadSecretsPanel } from './secrets-panel';

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
const locals = { token: 'tok', user: { id: 'u1' }, impersonation: null };
const ev = (cookies: ReturnType<typeof jar>, extra: object = {}) => ({ params: { appId: 'app-1' }, locals, cookies, ...extra }) as never;
const panel = (c: ReturnType<typeof jar>, l: object = locals, appId = 'app-1') => loadSecretsPanel(true, { request } as never, appId, l as never, c as never, () => {});

const open = { id: 'r1', state: 'open', operation: 'STORE', createdAt: '2026-11-21T00:00:00Z', expiresAt: '2026-11-21T01:00:00Z' };
const reads = (cr: unknown) => async (q: string) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === APP_SECRETS_QUERY) return { secrets: { total: 0, items: [] } };
  if (q === SECRET_CHANGE_REQUEST_QUERY) return { secretChangeRequest: cr };
};

beforeEach(() => { request.mockReset(); env.PUBLIC_SERVER_URL = 'https://hadron.example'; });

describe('the section read', () => {
  it('reads nothing, and sets no header, unless the section is asked for', async () => {
    const headers = vi.fn();
    expect(await loadSecretsPanel(false, { request } as never, 'app-1', locals as never, jar() as never, headers)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(headers).not.toHaveBeenCalled();
  });
  it('reads only secrets, the signing probe and tracked requests, and is private and uncached', async () => {
    const headers = vi.fn();
    request.mockImplementation(async (q: string) => {
      if (q === APP_SECRETS_QUERY) return { secrets: { total: 1, items: [secret] } };
      if (q === SECRET_CHANGE_REQUEST_QUERY) return { secretChangeRequest: null };
    });
    const d = (await loadSecretsPanel(true, { request } as never, 'app-1', locals as never, jar() as never, headers))!;
    expect(d.secrets.kind).toBe('ok');
    expect(d.signing).toBe('on');
    expect(headers).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  });
  it('a staged create reads as a create, not as a new value, and shows once under the App', async () => {
    const c = jar(JSON.stringify([{ create: { appId: 'app-1', name: 'k' }, requestId: 'r1', ceremonyUrl: URL_ }]));
    request.mockImplementation(reads(open));
    const d = (await panel(c))!;
    expect(d.pending).toHaveLength(1);
    expect(d.pending[0]).toMatchObject({ createName: 'k', secretId: null, operation: 'CREATE' });
  });
  it('a create of another App is not shown on this one', async () => {
    request.mockImplementation(reads(open));
    const c = jar(JSON.stringify([{ create: { appId: 'app-2', name: 'k' }, requestId: 'r1', ceremonyUrl: URL_ }]));
    expect((await panel(c))!.pending).toEqual([]);
  });
});

describe('createSecret', () => {
  it('a protected create is staged (no row yet) and remembered under the App id and name', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; if (q === CREATE_SECRET_MUTATION) throw staged(); });
    const c = jar();
    const r = await actions.createSecret(ev(c, { request: form({ name: 'stripe-key', value: 'sk', protected: 'on' }) }));
    expect(r).toEqual({ action: 'createSecret', staged: true, name: 'stripe-key' });
    expect(JSON.parse(c.store.get(TRACKED_COOKIE)!)).toEqual([{ create: { appId: 'app-1', name: 'stripe-key' }, requestId: 'r1' }]);
    expect(request).toHaveBeenCalledWith(CREATE_SECRET_MUTATION, expect.objectContaining({ ownerRef: 'app-1', kind: 'generic', protected: true }));
  });
  it('rejects a bad name and an empty value before any call', async () => {
    const { actions } = await import('./+page.server');
    const bad = (await actions.createSecret(ev(jar(), { request: form({ name: 'Bad Name', value: 'x' }) }))) as { status: number };
    const empty = (await actions.createSecret(ev(jar(), { request: form({ name: 'ok', value: ' ' }) }))) as { status: number };
    expect([bad.status, empty.status]).toEqual([400, 400]);
    expect(request).not.toHaveBeenCalled();
  });
  it('an unprotected create leaves the protected argument out; a protected one sends true', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { createSecret: secret }));
    await actions.createSecret(ev(jar(), { request: form({ name: 'a-key', value: 'v' }) }));
    expect(request.mock.calls.at(-1)![1]).not.toHaveProperty('protected');
    await actions.createSecret(ev(jar(), { request: form({ name: 'a-key', value: 'v', protected: 'on' }) }));
    expect(request.mock.calls.at(-1)![1]).toMatchObject({ protected: true });
  });
  it('a create made through the URL handle is remembered under the App id', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; if (q === CREATE_SECRET_MUTATION) throw staged(); });
    const c = jar();
    await actions.createSecret(ev(c, { params: { appId: 'team' }, request: form({ name: 'k', value: 'v', protected: 'on' }) }));
    expect(request).toHaveBeenCalledWith(CREATE_SECRET_MUTATION, expect.objectContaining({ ownerRef: 'app-1' }));
    expect(JSON.parse(c.store.get(TRACKED_COOKIE)!)[0].create).toEqual({ appId: 'app-1', name: 'k' });
  });
});

describe('withdrawSecret', () => {
  it('sends once, then the request is forgotten', async () => {
    const { actions } = await import('./+page.server');
    request.mockImplementation(async () => ({ withdrawSecretChangeRequest: true }));
    const c = jar(JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl: URL_ }]));
    expect(await actions.withdrawSecret(ev(c, { request: form({ requestId: 'r1' }) }))).toEqual({ action: 'withdrawSecret', ok: true });
    expect(request).toHaveBeenCalledWith(WITHDRAW_CHANGE_REQUEST_MUTATION, { id: 'r1' });
    expect(c.store.has(TRACKED_COOKIE)).toBe(false);
  });
});

describe('portal#2578: the impersonation guards', () => {
  const impersonated = { token: 'tok', user: { id: 'u2' }, impersonation: { by: 'admin' } };
  const inCookie = JSON.stringify([{ create: { appId: 'app-1', name: 'k' }, requestId: 'r1' }]);

  // Kills: deleting the guard at the top of `createSecret`. Without it an admin's stray create would reach the server as the impersonated user.
  it('create is refused (403) before any call, and the cookie is untouched', async () => {
    const { actions } = await import('./+page.server');
    const c = jar(inCookie);
    const r = (await actions.createSecret(ev(c, { locals: impersonated, request: form({ name: 'k', value: 'v' }) }))) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
    expect(c.store.get(TRACKED_COOKIE)).toBe(inCookie);
  });
  // Kills: deleting the guard at the top of `withdrawSecret`, which would also forget the request in the admin's cookie.
  it('withdraw is refused (403) before any call, and the cookie is untouched', async () => {
    const { actions } = await import('./+page.server');
    const c = jar(inCookie);
    const r = (await actions.withdrawSecret(ev(c, { locals: impersonated, request: form({ requestId: 'r1' }) }))) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
    expect(c.store.get(TRACKED_COOKIE)).toBe(inCookie);
  });
  // Kills: the read dropping `!!locals.impersonation` (readOnly): a failed read would then write a failure count into the admin's cookie.
  it('impersonation plus a failed read: the notice counts it and the cookie is not rewritten', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === APP_SECRETS_QUERY) return { secrets: { total: 0, items: [] } };
      if (q === SECRET_CHANGE_REQUEST_QUERY) throw new Error('down');
    });
    const c = jar(inCookie);
    const d = (await panel(c, impersonated))!;
    expect(d.pending).toEqual([]);
    expect(d.pendingUnchecked).toBe(1);
    expect(c.store.get(TRACKED_COOKIE)).toBe(inCookie);
  });
});
