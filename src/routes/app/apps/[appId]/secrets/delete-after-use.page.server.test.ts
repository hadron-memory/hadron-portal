/**
 * portal#2679 — the delete-after-use option on an App secret (hadron-server#5335). Unprotected
 * saves through updateSecret at once; protected is STAGED through the requester's ceremony, as
 * every other protected change. Red on main: there was no action, no mutation and no field read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import * as secrets from '$lib/server/secrets';
import { SECRET_QUERY } from '$lib/server/secrets';
import { TRACKED_COOKIE } from '$lib/secrets/tracked';
import { env } from '$env/dynamic/public';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', protected: true, deleteAfterUse: false, currentVersion: 2, metadata: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const URL_ = 'https://hadron.example/secret-changes/r1';
const err = (extensions: Record<string, unknown>, message = 'x') => ({ response: { errors: [{ message, extensions }] }, request: { query: '', variables: {} } });
const staged = () => err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: URL_ });

function jar() {
  const store = new Map<string, string>();
  return { store, get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v), delete: (k: string) => void store.delete(k) };
}
const form = (o: Record<string, string>) => ({ formData: async () => new URLSearchParams(o) as unknown as FormData });
const ev = (cookies: ReturnType<typeof jar>, extra: object = {}) => ({
  params: { appId: 'app-1', secretId: 's1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation: null }, cookies, ...extra,
}) as never;
const owned = (impl: (q: string, v?: unknown) => unknown) => async (q: string, v?: unknown) => (q === AGENT_TASKS_APP_QUERY ? { app } : q === SECRET_QUERY ? { secret } : impl(q, v));

beforeEach(() => { request.mockReset(); env.PUBLIC_SERVER_URL = 'https://hadron.example'; });

describe('the secret reads deleteAfterUse', () => {
  it('the shared fragment selects it, so the page can show the state', () => {
    expect(secrets.SECRET_QUERY).toContain('SecretFields');
    expect(secrets.UPDATE_SECRET_VALUE_MUTATION).toContain('SecretFields');
    expect(secrets.APP_SECRETS_QUERY).toContain('SecretFields');
    // the fragment is spread by all three; the field must be in it
    expect(secrets.SECRET_QUERY.replace(/\s+/g, ' ')).toMatch(/fragment SecretFields on Secret \{[^}]*\bdeleteAfterUse\b/);
  });
});

describe('the deleteAfterUse action', () => {
  it('sends the typed Boolean to updateSecret, alone, and reports a plain save', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => ({ updateSecret: { ...secret, protected: false, deleteAfterUse: true } })));
    const r = await (actions as Record<string, (e: never) => unknown>).deleteAfterUse(ev(jar(), { request: form({ deleteAfterUse: 'true' }) }));
    expect(r).toEqual({ action: 'deleteAfterUse', ok: true });
    const call = request.mock.calls.find(([q]) => q === secrets.UPDATE_SECRET_DELETE_AFTER_USE_MUTATION);
    expect(call?.[1]).toEqual({ ref: 's1', deleteAfterUse: true });
  });

  it('turning it off sends false, not an absent field', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned(() => ({ updateSecret: secret })));
    await (actions as Record<string, (e: never) => unknown>).deleteAfterUse(ev(jar(), { request: form({ deleteAfterUse: 'false' }) }));
    const call = request.mock.calls.find(([q]) => q === secrets.UPDATE_SECRET_DELETE_AFTER_USE_MUTATION);
    expect(call?.[1]).toEqual({ ref: 's1', deleteAfterUse: false });
  });

  it('on a protected secret it is staged, the request is remembered, and nothing says saved', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    request.mockImplementation(owned((q) => { if (q === secrets.UPDATE_SECRET_DELETE_AFTER_USE_MUTATION) throw staged(); }));
    const c = jar();
    const r = (await (actions as Record<string, (e: never) => unknown>).deleteAfterUse(ev(c, { request: form({ deleteAfterUse: 'true' }) }))) as Record<string, unknown>;
    expect(r).toEqual({ action: 'deleteAfterUse', staged: true });
    expect(c.store.get(TRACKED_COOKIE)).toBe(JSON.stringify([{ secretId: 's1', requestId: 'r1' }]));
  });

  it('an impersonation session cannot change it', async () => {
    const { actions } = await import('./[secretId]/+page.server');
    const r = (await (actions as Record<string, (e: never) => unknown>).deleteAfterUse(ev(jar(), { request: form({ deleteAfterUse: 'true' }), locals: { token: 't', user: { id: 'u1' }, impersonation: { id: 'x' } } }))) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});
