import { json } from '@sveltejs/kit';
import { startBoundMagicLink } from '$lib/server/emailLogin';
import { isLocalPath } from '$lib/safeRedirect';
import type { RequestHandler } from './$types';

/**
 * #505 — magic-link request with a session-fixation binding. The signin/signup
 * pages POST here (same origin) instead of straight to the server's /auth/email,
 * so an HttpOnly nonce cookie can be set on the portal origin before the link is
 * sent. See $lib/server/emailLogin.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; redirect?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  // Only forward a same-origin local path (#439). A direct POST could otherwise
  // carry an absolute/protocol-relative target that would later open-redirect
  // the authenticated victim off-site (the signin/signup pages already filter
  // client-side, but this server endpoint must not trust that).
  const rawRedirect = typeof body.redirect === 'string' ? body.redirect : undefined;
  const redirect = isLocalPath(rawRedirect) ? rawRedirect : undefined;
  if (!email) return json({ error: 'Email is required' }, { status: 400 });

  const result = await startBoundMagicLink(cookies, email, redirect);
  if (!result.ok) return json({ error: result.error }, { status: result.status });
  return json({ ok: true });
};
