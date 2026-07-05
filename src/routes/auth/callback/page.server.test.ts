/**
 * #477 — login callback. Verifies the one-time code is redeemed server-to-server
 * (JWT arrives in the body, not a URL), the browser nonce is forwarded as
 * clientState, the HttpOnly session cookie is seated, and a redemption failure
 * routes to the sign-in error page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { LOCAL_SERVER_URL: 'http://server.internal:4000' } }));

vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/queries', () => ({ ORGANIZATIONS_NAV_QUERY: 'query Orgs {}' }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/server/active-org', () => ({
  resolveActiveOrg: () => ({ activeOrgId: null }),
  filterToMemberOrgs: (orgs: unknown[]) => orgs,
}));
vi.mock('$lib/safeRedirect', () => ({ safeRedirect: (p: string) => p }));

import { load } from './+page.server';

type CookieOp = { name: string; value?: string; opts: Record<string, unknown> };

function makeEvent(opts: { code?: string; loginState?: string }) {
  const ops: CookieOp[] = [];
  const url = new URL('https://portal.example.test/auth/callback');
  if (opts.code) url.searchParams.set('code', opts.code);
  return {
    url,
    cookies: {
      get: (name: string) => (name === 'hadron_login_state' ? opts.loginState : undefined),
      set: (name: string, value: string, o: Record<string, unknown>) => ops.push({ name, value, opts: o }),
      delete: (name: string, o: Record<string, unknown>) => ops.push({ name, opts: o }),
    },
    _ops: ops,
  } as unknown as Parameters<typeof load>[0] & { _ops: CookieOp[] };
}

async function runLoad(event: ReturnType<typeof makeEvent>): Promise<{ status: number; location: string }> {
  try {
    await load(event);
    throw new Error('expected a redirect');
  } catch (e) {
    return e as { status: number; location: string };
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('/auth/callback', () => {
  it('redeems the code (forwarding clientState) and seats an HttpOnly cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ token: 'jwt.a.b', redirect: '/app/setup', isNew: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const event = makeEvent({ code: 'the-code', loginState: 'nonce-xyz' });
    const thrown = await runLoad(event);

    // Redeemed server-to-server against LOCAL_SERVER_URL with code + clientState.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://server.internal:4000/auth/session',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ code: 'the-code', clientState: 'nonce-xyz' });

    // Session cookie seated HttpOnly; the login-state nonce cleared.
    const tokenCookie = event._ops.find((o) => o.name === 'hadron_token');
    expect(tokenCookie?.value).toBe('jwt.a.b');
    expect(tokenCookie?.opts.httpOnly).toBe(true);
    expect(event._ops.find((o) => o.name === 'hadron_login_state' && o.value === undefined)).toBeDefined();

    // Honors the server-provided destination.
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe('/app/setup');
  });

  it('redirects to / when no code is present', async () => {
    const thrown = await runLoad(makeEvent({}));
    expect(thrown.location).toBe('/');
  });

  it('routes to the sign-in error page when redemption fails (bad/expired/fixation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    const event = makeEvent({ code: 'bad', loginState: 'nonce' });
    const thrown = await runLoad(event);
    expect(thrown.location).toBe('/signin?error=auth');
    // No session cookie on failure.
    expect(event._ops.find((o) => o.name === 'hadron_token')).toBeUndefined();
  });
});
