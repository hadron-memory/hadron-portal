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

/**
 * #761 — carry an incoming query string onto a redirect target.
 *
 * A redirect that rewrites the PATH must not also discard the caller's STATE.
 * The portal's alias and canonicalization redirects (`/app/u/[urn]`, the memory
 * tab index, the #237 node-moved hop) all send the reader somewhere else by
 * design, and every one of them was dropping `?tab=`/`?chat=`/the #739 worklog
 * filters on the way — resolving and rendering without error, on the target's
 * default view. Nothing fails; the reader just silently loses what they linked.
 *
 * `search` is `URL.search`: either empty or `?`-prefixed, which is why the
 * empty case returns `path` untouched rather than appending a bare `?`.
 * Targets that already carry a query are joined with `&`, so composing never
 * produces the `?a=b?c=d` that truncates at the second `?`.
 */
export function withQuery(path: string, search: string): string {
  if (!search || search === '?') return path;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`;
}
