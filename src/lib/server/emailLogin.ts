import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

/**
 * #505 — start a magic-link sign-in with a session-fixation binding.
 *
 * Sets an HttpOnly browser nonce (`hadron_login_state`, portal origin) and
 * forwards it to the server as `clientState`. The server stores its hash on the
 * EmailVerificationToken and binds the eventual handoff code to it, so only THIS
 * browser (which holds the cookie) can complete sign-in at /auth/callback. This
 * makes magic links same-browser-only by design — the fixation defense requires
 * the redeeming browser to be the requesting one.
 *
 * Shared by the /auth/start/email endpoint (signin/signup) and the invite
 * sendEmail action so the binding is established identically everywhere.
 */
export async function startBoundMagicLink(
  cookies: Cookies,
  email: string,
  redirect?: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const clientState = randomBytes(32).toString('hex');
  cookies.set('hadron_login_state', clientState, {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 20, // 20 min — covers the server's 15-min magic-link token + slack
  });

  const serverUrl = env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${serverUrl}/auth/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, redirect, clientState }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, status: res.status, error: data.error ?? 'Failed to send email' };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 502, error: 'Could not reach the server.' };
  }
}
