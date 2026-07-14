/**
 * Google login start route. Verifies the same nonce binding and redirect
 * safety contract as the GitHub login start route.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SERVER_URL: 'https://api.example.test' } }));

import { GET } from './+server';

type CookieSet = { name: string; value: string; opts: Record<string, unknown> };

function makeEvent(rawRedirect: string | null) {
  const cookies: CookieSet[] = [];
  const url = new URL('https://portal.example.test/auth/start/google');
  if (rawRedirect !== null) url.searchParams.set('redirect', rawRedirect);
  return {
    url,
    cookies: {
      set: (name: string, value: string, opts: Record<string, unknown>) =>
        cookies.push({ name, value, opts }),
    },
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

describe('/auth/start/google', () => {
  it('sets an HttpOnly nonce cookie and forwards it as client_state', () => {
    const event = makeEvent('/app/orgs/o1');
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
    expect(loc.pathname).toBe('/auth/google');
    expect(loc.searchParams.get('redirect')).toBe('/app/orgs/o1');
    expect(loc.searchParams.get('client_state')).toBe(cookie!.value);
  });

  it.each([
    ['absolute', 'https://evil.example/steal'],
    ['protocol-relative', '//evil.example'],
    ['backslash-obfuscated', '/\\evil.example/path'],
  ])('falls back to the dashboard for a %s redirect', (_label, redirectAttempt) => {
    const thrown = runGet(makeEvent(redirectAttempt));
    expect(new URL(thrown.location).searchParams.get('redirect')).toBe('/app/dashboard');
  });
});
