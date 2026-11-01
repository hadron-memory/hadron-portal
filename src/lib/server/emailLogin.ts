import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type { ErrorStatus } from 'sveltekit-superforms';
import { emailSignInStrings } from '$lib/i18n/email-sign-in-strings';
import { BOT_CHECK_ERROR, TURNSTILE_FIELD, botCheckMessage } from '$lib/turnstile';

/**
 * portal#1528 — how long the portal waits for hadron-server's `/auth/email`.
 * Well under the edge's own ~100 s timeout (a 524 the browser can only show as
 * a failed submit), and well above what the server does for this call (one
 * token insert and one provider handoff), so a real answer, refusals included,
 * still arrives first.
 */
export const EMAIL_LOGIN_TIMEOUT_MS = 20_000;


export function emailLoginErrorStatus(status: number): ErrorStatus {
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status as ErrorStatus;
  return 500;
}

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
 * With `turnstileToken` (#1470) it also forwards the Turnstile response as
 * `cf-turnstile-response`; the token is never logged or stored.
 *
 * Shared by Superforms-backed email auth actions, the invite sendEmail action,
 * and the backwards-compatible /auth/start/email JSON endpoint so the binding is
 * established identically everywhere.
 */
export async function startBoundMagicLink(
  cookies: Cookies,
  email: string,
  redirect?: string,
  turnstileToken?: string,
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
  // portal#1528: bounded with a plain timer (not AbortSignal.timeout) so the
  // body read below is covered too, and so a test's fake clock can drive it.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EMAIL_LOGIN_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl}/auth/email`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      // #1470: the token joins the body only when there is one, so with no
      // widget the request is byte-identical to what it was before.
      body: JSON.stringify({
        email,
        redirect,
        clientState,
        ...(turnstileToken ? { [TURNSTILE_FIELD]: turnstileToken } : {}),
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      // As on the 2xx branch below: a body read that outlives the bound is unconfirmed.
      if (timedOut) return { ok: false, status: 504, error: emailSignInStrings.unconfirmed() };
      // #1470: a refused bot check carries a machine code, not something to show.
      if (data.error === BOT_CHECK_ERROR) {
        return { ok: false, status: res.status, error: botCheckMessage(data.reason) };
      }
      return { ok: false, status: res.status, error: data.error ?? emailSignInStrings.failedToSend() };
    }
    // portal#1528: only hadron-server's own acknowledgement is a send. A 2xx
    // from anything else in the path (a proxy, a cached or HTML page) is not.
    const data = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (data?.ok !== true) {
      // The body read itself can outlive the bound; that is still unconfirmed, not refused.
      if (timedOut) return { ok: false, status: 504, error: emailSignInStrings.unconfirmed() };
      return { ok: false, status: 502, error: emailSignInStrings.failedToSend() };
    }
    return { ok: true };
  } catch {
    if (timedOut) return { ok: false, status: 504, error: emailSignInStrings.unconfirmed() };
    return { ok: false, status: 502, error: emailSignInStrings.unreachable() };
  } finally {
    clearTimeout(timer);
  }
}
