/**
 * #1470 — Cloudflare Turnstile on the email sign-in forms (hadron-server#2878,
 * R210 `cor:aut:030:01`).
 *
 * The widget puts its one-time challenge response in a hidden input with
 * Cloudflare's own field name, and hadron-server reads the same name, so the
 * token rides through the portal's form action untouched.
 */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

export const BOT_CHECK_RETRY_MESSAGE = 'Complete the check and try again.';
export const BOT_CHECK_UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable. Please try again later.';

/** The only error code hadron-server answers a refused bot check with. */
export const BOT_CHECK_ERROR = 'bot_check_failed';

/**
 * The text a person sees for a refused bot check. The server's `reason` is a
 * code for us, never copy for them: a missing or rejected token is something
 * they can fix by redoing the check; anything else (provider down, check not
 * configured, a reason this build has not met) is not theirs to fix.
 */
export function botCheckMessage(reason: unknown): string {
  return reason === 'missing_token' || reason === 'invalid_token'
    ? BOT_CHECK_RETRY_MESSAGE
    : BOT_CHECK_UNAVAILABLE_MESSAGE;
}

/** A submitted token, or undefined when the field is absent or blank. */
export function turnstileToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
