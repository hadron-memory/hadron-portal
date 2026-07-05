/**
 * #477 — GitHub login start route. Verifies the session-fixation nonce is set as
 * an HttpOnly cookie and forwarded to the server as `client_state`, and that the
 * post-auth `redirect` is open-redirect-safe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SERVER_URL: 'https://api.example.test' } }));

import { GET } from './+server';

type CookieSet = { name: string; value: string; opts: Record<string, unknown> };

function makeEvent(rawRedirect: string | null) {
  const cookies: CookieSet[] = [];
  const url = new URL(`https://portal.example.test/auth/start/github`);
  if (rawRedirect !== null) url.searchParams.set('redirect', rawRedirect);
  return {
    url,
    cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => cookies.push({ name, value, opts }) },
    _cookies: cookies,
  } as unknown as Parameters<typeof GET>[0] & { _cookies: CookieSet[] };
}

function runGet(event: ReturnType<typeof makeEvent>): { status: number; location: string } {
  try {
    GET(event);
    throw new Error('expected a redirect');
  } catch (e) {
    return e as { status: number; location: string };
  }
}

describe('/auth/start/github', () => {
  let event: ReturnType<typeof makeEvent>;

  it('sets an HttpOnly nonce cookie and forwards it as client_state', () => {
    event = makeEvent('/app/orgs/o1');
    const thrown = runGet(event);

    const cookie = event._cookies.find((c) => c.name === 'hadron_login_state');
    expect(cookie).toBeDefined();
    expect(cookie!.opts.httpOnly).toBe(true);
    expect(cookie!.opts.sameSite).toBe('lax');
    expect(cookie!.opts.path).toBe('/auth');
    expect(cookie!.value).toMatch(/^[0-9a-f]{64}$/);

    expect(thrown.status).toBe(302);
    const loc = new URL(thrown.location);
    expect(loc.origin).toBe('https://api.example.test');
    expect(loc.pathname).toBe('/auth/github');
    expect(loc.searchParams.get('redirect')).toBe('/app/orgs/o1');
    // The forwarded client_state equals the cookie value (the binding).
    expect(loc.searchParams.get('client_state')).toBe(cookie!.value);
  });

  it('falls back to /app/dashboard for an open-redirect attempt', () => {
    const thrown = runGet(makeEvent('https://evil.example/steal'));
    expect(new URL(thrown.location).searchParams.get('redirect')).toBe('/app/dashboard');
  });

  it('falls back for a protocol-relative redirect', () => {
    const thrown = runGet(makeEvent('//evil.example'));
    expect(new URL(thrown.location).searchParams.get('redirect')).toBe('/app/dashboard');
  });
});
