/**
 * #974 — an /app form action with no live session goes to sign-in, before any
 * action code (and so before any credential-less call to hadron-server).
 */
import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import {
  isFormActionRequest,
  isSignedOutAppAction,
  sessionActionGuard,
  signinRedirectFor,
} from './session-action-guard';

const ENHANCED = { 'x-sveltekit-action': 'true', accept: 'application/json' };
const NO_JS = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'content-type': 'application/x-www-form-urlencoded' };
const FETCH = { 'content-type': 'application/json' }; // fetch() default accept: */*

function event(path: string, opts: { method?: string; headers?: Record<string, string>; user?: boolean } = {}) {
  const url = new URL(`http://localhost${path}`);
  return {
    url,
    request: new Request(url, { method: opts.method ?? 'POST', headers: opts.headers ?? ENHANCED }),
    locals: { user: opts.user ? { id: 'u1' } : null, token: opts.user ? 'jwt' : null },
  } as never;
}

async function run(ev: never) {
  const resolve = vi.fn(async () => new Response('page'));
  try {
    const res = await sessionActionGuard({ event: ev, resolve } as never);
    return { redirect: null, resolved: resolve.mock.calls.length, res };
  } catch (e) {
    if (!isRedirect(e)) throw e;
    return { redirect: { status: e.status, location: e.location }, resolved: resolve.mock.calls.length, res: null };
  }
}

describe('isFormActionRequest', () => {
  it('an enhanced submit and a no-JS form post are actions', () => {
    expect(isFormActionRequest(new Request('http://x/app', { method: 'POST', headers: ENHANCED }))).toBe(true);
    expect(isFormActionRequest(new Request('http://x/app', { method: 'POST', headers: NO_JS }))).toBe(true);
  });

  it('a fetch() POST to a +server.ts endpoint is not, and neither is a GET', () => {
    expect(isFormActionRequest(new Request('http://x/app', { method: 'POST', headers: FETCH }))).toBe(false);
    expect(isFormActionRequest(new Request('http://x/app', { method: 'GET', headers: NO_JS }))).toBe(false);
  });
});

describe('signinRedirectFor', () => {
  it('returns to the page, keeping its query and dropping the action selector', () => {
    expect(signinRedirectFor(new URL('http://x/app/apps/a1?/postTeamChatMessage'))).toBe(
      `/signin?redirect=${encodeURIComponent('/app/apps/a1')}`,
    );
    expect(signinRedirectFor(new URL('http://x/app/apps/a1?tab=chats&/postTeamChatMessage'))).toBe(
      `/signin?redirect=${encodeURIComponent('/app/apps/a1?tab=chats')}`,
    );
  });
});

describe('sessionActionGuard (#974)', () => {
  it('a signed-out enhanced action is sent to sign-in, and the action never runs', async () => {
    const r = await run(event('/app/apps/a1?/postTeamChatMessage'));
    expect(r.redirect).toEqual({ status: 303, location: `/signin?redirect=${encodeURIComponent('/app/apps/a1')}` });
    expect(r.resolved).toBe(0);
  });

  it('a signed-out no-JS form post too', async () => {
    const r = await run(event('/app/agents/x?/update', { headers: NO_JS }));
    expect(r.redirect?.status).toBe(303);
    expect(r.resolved).toBe(0);
  });

  it('a signed-in action runs', async () => {
    const r = await run(event('/app/apps/a1?/postTeamChatMessage', { user: true }));
    expect(r.redirect).toBeNull();
    expect(r.resolved).toBe(1);
  });

  it('leaves a signed-out fetch() POST to an /app endpoint to that endpoint', async () => {
    const r = await run(event('/app/dashboard/widget-presets', { headers: FETCH }));
    expect(r.redirect).toBeNull();
    expect(r.resolved).toBe(1);
  });

  it('leaves signed-out GETs to the /app layout, and actions outside /app alone', async () => {
    expect((await run(event('/app/dashboard', { method: 'GET', headers: NO_JS }))).resolved).toBe(1);
    expect((await run(event('/signin?/magic'))).resolved).toBe(1);
    expect((await run(event('/application?/x'))).resolved).toBe(1); // a prefix, not /app
  });

  it('isSignedOutAppAction reads the user, not the token', () => {
    expect(isSignedOutAppAction(event('/app/x?/y'))).toBe(true);
    expect(isSignedOutAppAction(event('/app/x?/y', { user: true }))).toBe(false);
  });
});
