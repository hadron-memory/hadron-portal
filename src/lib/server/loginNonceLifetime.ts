/**
 * portal#1091 (nonce-only slice) — how long the browser login nonce
 * (`hadron_login_state`) must live.
 *
 * The nonce binds the eventual handoff code to the browser that asked for the
 * sign-in. With the server's passkey step on, that browser first redeems the
 * magic link, then the server holds a PENDING flow until the factor completes:
 * 10 min for an existing passkey, 30 min for a first enrolment (a second
 * emailed link, then the registration). The nonce has to outlive the longest
 * of those, from the moment the link was requested.
 *
 *   lifetime = link token + the longest pending flow + slack
 *
 * The figures below mirror hadron-server at a053f05c, `src/auth/pendingEmailSignIn.ts`
 * (PENDING_EMAIL_SIGN_IN_TTL_SECONDS, PENDING_ENROLLMENT_TTL_SECONDS) and the
 * magic-link token expiry. They are restated, not imported: the portal does not
 * build against the server's source. When hadron-server#2254 or any later change
 * moves one, change it here; the pin in emailLogin.test.ts states the expected
 * total independently so the two cannot drift silently.
 *
 * This is the browser's cookie only. It does not extend the server's challenge,
 * freshness or session lifetimes, and an expired nonce still fails closed at
 * /auth/callback (303 /signin?error=auth).
 */
export const MAGIC_LINK_TOKEN_SECONDS = 15 * 60;
export const PENDING_EMAIL_SIGN_IN_TTL_SECONDS = 10 * 60;
export const PENDING_ENROLLMENT_TTL_SECONDS = 30 * 60;
export const LOGIN_NONCE_SLACK_SECONDS = 5 * 60;

export const LOGIN_NONCE_MAX_AGE_SECONDS =
  MAGIC_LINK_TOKEN_SECONDS +
  Math.max(PENDING_EMAIL_SIGN_IN_TTL_SECONDS, PENDING_ENROLLMENT_TTL_SECONDS) +
  LOGIN_NONCE_SLACK_SECONDS;
