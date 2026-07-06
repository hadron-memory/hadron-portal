import { json } from '@sveltejs/kit';
import { startBoundMagicLink } from '$lib/server/emailLogin';
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
  const redirect = typeof body.redirect === 'string' ? body.redirect : undefined;
  if (!email) return json({ error: 'Email is required' }, { status: 400 });

  const result = await startBoundMagicLink(cookies, email, redirect);
  if (!result.ok) return json({ error: result.error }, { status: result.status });
  return json({ ok: true });
};
