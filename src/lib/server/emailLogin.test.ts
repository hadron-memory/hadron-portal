/**
 * #505 — startBoundMagicLink sets the session-fixation nonce cookie and forwards
 * it to the server as clientState, so the minted handoff code binds to this
 * browser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { LOCAL_SERVER_URL: 'http://server.internal:4000' } }));

import { emailLoginErrorStatus, startBoundMagicLink } from './emailLogin';

type CookieSet = { name: string; value: string; opts: Record<string, unknown> };

function cookieStub() {
  const sets: CookieSet[] = [];
  return {
    sets,
    cookies: {
      set: (name: string, value: string, opts: Record<string, unknown>) => sets.push({ name, value, opts }),
    } as never,
  };
}

beforeEach(() => vi.unstubAllGlobals());

describe('emailLoginErrorStatus', () => {
  it('passes through 4xx and 5xx statuses', () => {
    expect(emailLoginErrorStatus(400)).toBe(400);
    expect(emailLoginErrorStatus(503)).toBe(503);
  });

  it('falls back to 500 for non-error statuses', () => {
    expect(emailLoginErrorStatus(302)).toBe(500);
    expect(emailLoginErrorStatus(400.5)).toBe(500);
    expect(emailLoginErrorStatus(600)).toBe(500);
  });
});

describe('startBoundMagicLink', () => {
  it('sets an HttpOnly nonce cookie and forwards it as clientState', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { cookies, sets } = cookieStub();

    const result = await startBoundMagicLink(cookies, 'user@example.test', '/invite/x');
    expect(result).toEqual({ ok: true });

    const cookie = sets.find((c) => c.name === 'hadron_login_state');
    expect(cookie).toBeDefined();
    expect(cookie!.opts.httpOnly).toBe(true);
    expect(cookie!.opts.path).toBe('/auth');
    expect(cookie!.value).toMatch(/^[0-9a-f]{64}$/);

    // Forwarded to the server with the SAME nonce as the cookie.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://server.internal:4000/auth/email',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ email: 'user@example.test', redirect: '/invite/x', clientState: cookie!.value });
  });

  it('propagates a server error with its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'client_state is required' }) }));
    const { cookies } = cookieStub();
    const result = await startBoundMagicLink(cookies, 'user@example.test');
    expect(result).toEqual({ ok: false, status: 400, error: 'client_state is required' });
  });

  it('returns a 502 when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { cookies } = cookieStub();
    const result = await startBoundMagicLink(cookies, 'user@example.test');
    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

// #1470 — Turnstile token forwarding (hadron-server#2878 contract).
describe('startBoundMagicLink with a Turnstile token', () => {
  const TOKEN = 'cf-token-123';

  it('forwards the token as cf-turnstile-response and keeps it out of cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { cookies, sets } = cookieStub();

    await startBoundMagicLink(cookies, 'user@example.test', '/x', TOKEN);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body['cf-turnstile-response']).toBe(TOKEN);
    expect(JSON.stringify(sets)).not.toContain(TOKEN);
  });

  it('without a token the body is byte-identical to main (no field, not even null)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { cookies, sets } = cookieStub();

    await startBoundMagicLink(cookies, 'user@example.test', '/x');

    const state = sets.find((c) => c.name === 'hadron_login_state')!.value;
    expect((fetchMock.mock.calls[0][1] as { body: string }).body).toBe(
      JSON.stringify({ email: 'user@example.test', redirect: '/x', clientState: state }),
    );
  });

  it('maps 403 invalid_token and missing_token to a retry message with no reason code', async () => {
    for (const reason of ['invalid_token', 'missing_token']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 403, json: async () => ({ error: 'bot_check_failed', reason }),
      }));
      const result = await startBoundMagicLink(cookieStub().cookies, 'user@example.test', undefined, TOKEN);
      expect(result).toEqual({ ok: false, status: 403, error: 'Complete the check and try again.' });
    }
  });

  it('maps 503 provider_error and not_configured to the unavailable message with no reason code', async () => {
    for (const reason of ['provider_error', 'not_configured']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 503, json: async () => ({ error: 'bot_check_failed', reason }),
      }));
      const result = await startBoundMagicLink(cookieStub().cookies, 'user@example.test', undefined, TOKEN);
      expect(result).toEqual({
        ok: false,
        status: 503,
        error: 'Sign-in is temporarily unavailable. Please try again later.',
      });
    }
  });

  it('never shows the raw code, even for a reason this build has not met', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: 'bot_check_failed', reason: 'brand_new_reason' }),
    }));
    const result = await startBoundMagicLink(cookieStub().cookies, 'user@example.test', undefined, TOKEN);
    expect(JSON.stringify(result)).not.toMatch(/bot_check_failed|brand_new_reason/);
  });
});
