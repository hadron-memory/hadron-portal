import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { safeRedirect } from '$lib/safeRedirect';
import { publicServerBaseUrl } from '$lib/public-server-base-url';
import type { RequestHandler } from './$types';

/**
 * Google login start. Mirrors the GitHub start route's #477 browser binding:
 * the server stamps this nonce onto the single-use login handoff code, and
 * only the browser holding the HttpOnly cookie can redeem it.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
  const serverUrl = publicServerBaseUrl();
  const dest = safeRedirect(url.searchParams.get('redirect'));

  const clientState = randomBytes(32).toString('hex');
  cookies.set('hadron_login_state', clientState, {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
  });

  const target = new URL('/auth/google', serverUrl);
  target.searchParams.set('redirect', dest);
  target.searchParams.set('client_state', clientState);
  redirect(302, target.toString());
};
