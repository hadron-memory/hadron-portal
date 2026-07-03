/**
 * #439 — open-redirect guard for post-auth `?redirect=` destinations.
 *
 * A redirect target is only safe if it's a same-origin local path. Absolute
 * URLs (`https://evil`), protocol-relative (`//evil`), and backslash-obfuscated
 * (`/\evil`, which some browsers normalize to `//`) targets are all rejected —
 * otherwise a genuine sign-in can 303 the authenticated victim to an attacker
 * origin (a high-credibility phishing springboard on the trusted domain).
 */

/** True when `dest` is a safe same-origin local path (leading single `/`). */
export function isLocalPath(dest: string | null | undefined): dest is string {
  return typeof dest === 'string' && dest[0] === '/' && dest[1] !== '/' && dest[1] !== '\\';
}

/** Return `dest` if it's a safe local path, otherwise `fallback`. */
export function safeRedirect(dest: string | null | undefined, fallback = '/app/dashboard'): string {
  return isLocalPath(dest) ? dest : fallback;
}
