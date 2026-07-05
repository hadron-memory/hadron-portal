import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { randomBytes } from 'node:crypto';
import type { RequestHandler } from './$types';

/**
 * #477 — GitHub login start.
 *
 * The old flow linked the browser straight at `${server}/auth/github`, so the
 * session-fixation defense had nowhere to set a browser nonce. This server route
 * mints a nonce, stores it in an HttpOnly cookie, and forwards it to the server
 * as `client_state`. The server binds the login handoff code to this nonce; only
 * this browser (holding the cookie) can redeem the code at /auth/callback, so an
 * attacker can't lure a victim into finishing the attacker's login.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';

  // Post-auth destination — a portal-local path. Reject anything that could be
  // an open redirect (absolute/protocol-relative); fall back to the dashboard.
  const requested = url.searchParams.get('redirect');
  const dest =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/app/dashboard';

  const clientState = randomBytes(32).toString('hex');
  cookies.set('hadron_login_state', clientState, {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10, // 10 minutes — bounds the OAuth round-trip
  });

  const target = new URL('/auth/github', serverUrl);
  target.searchParams.set('redirect', dest);
  target.searchParams.set('client_state', clientState);
  redirect(302, target.toString());
};
