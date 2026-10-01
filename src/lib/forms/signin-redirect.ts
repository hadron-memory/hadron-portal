import type { ActionResult } from '@sveltejs/kit';

/**
 * #974: an /app form action with no live session is answered with a redirect
 * to sign-in (`sessionActionGuard`). `use:enhance` follows it by itself. A
 * hand-rolled `fetch('?/action')` client gets the same redirect as action
 * JSON and has to decide what to do with it, or the user never learns their
 * session is gone (#975 Codex P2).
 */

/** The sign-in location when `result` is the guard's redirect, else null. */
export function signinRedirectLocation(result: ActionResult): string | null {
  return result.type === 'redirect' && result.location.startsWith('/signin') ? result.location : null;
}
