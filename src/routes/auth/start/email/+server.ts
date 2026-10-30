import { json } from '@sveltejs/kit';
import { startBoundMagicLink } from '$lib/server/emailLogin';
import { isLocalPath } from '$lib/safeRedirect';
import type { RequestHandler } from './$types';

/**
 * #505 — backwards-compatible JSON magic-link request with a session-fixation
 * binding. Route forms use Superforms actions now, but this same-origin endpoint
 * remains for callers that still POST JSON instead of form data.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; redirect?: unknown; 'cf-turnstile-response'?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  // Only forward a same-origin local path (#439). A direct POST could otherwise
  // carry an absolute/protocol-relative target that would later open-redirect
  // the authenticated victim off-site.
  const rawRedirect = typeof body.redirect === 'string' ? body.redirect : undefined;
  const redirect = isLocalPath(rawRedirect) ? rawRedirect : undefined;
  if (!email) return json({ error: 'Email is required' }, { status: 400 });

  const result = await startBoundMagicLink(cookies, email, redirect,
    ...(typeof body['cf-turnstile-response'] === 'string' ? [body['cf-turnstile-response']] as [string] : []));
  if (!result.ok) return json({ error: result.error }, { status: result.status });
  return json({ ok: true });
};
