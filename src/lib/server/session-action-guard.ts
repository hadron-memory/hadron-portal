import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { withQuery } from '$lib/safeRedirect';

/**
 * #974 — a form action under /app with no live session goes to sign-in.
 *
 * The /app layout redirects a signed-out visitor from its LOAD, but a form
 * ACTION never runs that load. So once `authHandle` had cleared an expired
 * token, an action still called hadron-server with no credential, got
 * FORBIDDEN (the server answers a missing principal like a non-member,
 * hadron-server#1509), and showed "Posting needs App membership" to someone
 * whose only problem was an expired session.
 *
 * This runs for every /app action, before any action code. It THROWS the
 * redirect rather than building a response, so SvelteKit shapes it: an
 * enhanced submit gets the action-JSON `{ type: 'redirect' }` its client
 * follows, a no-JS post gets a plain 303, and the cookie `authHandle` deleted
 * rides along either way. A response built here instead would lose that
 * cookie, since SvelteKit attaches cookies only on the resolve path. The cost
 * of throwing is that the later header hooks don't run for this one bodiless
 * redirect, where there is nothing for those headers to protect.
 */

/**
 * True for a form action, as opposed to a `fetch()` to a `+server.ts` POST
 * under /app (e.g. the dashboard widget presets), which wants JSON and would
 * follow a redirect into the sign-in page's HTML.
 *
 * - An enhanced submit sends `x-sveltekit-action: true`; SvelteKit itself
 *   routes that to the page's actions, never an endpoint.
 * - A no-JS submit is a browser navigation, which asks for `text/html`. A
 *   `fetch()` accepts any type unless told otherwise, so it never matches.
 */
export function isFormActionRequest(request: Request): boolean {
  if (request.method !== 'POST') return false;
  if (request.headers.get('x-sveltekit-action') === 'true') return true;
  return (request.headers.get('accept') ?? '').includes('text/html');
}

function isAppPath(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

/**
 * Where to come back to after signing in: the page the form was on, with its
 * own query kept (#761) but the action selector (`?/name`) dropped, since a
 * GET to it would render the page, not re-run the action.
 */
export function signinRedirectFor(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (key.startsWith('/')) params.delete(key);
  }
  const search = params.toString();
  const back = withQuery(url.pathname, search ? `?${search}` : '');
  return `/signin?redirect=${encodeURIComponent(back)}`;
}

/** True when `event` is an /app form action with no signed-in user. */
export function isSignedOutAppAction(event: Pick<RequestEvent, 'url' | 'request' | 'locals'>): boolean {
  return !event.locals.user && isAppPath(event.url.pathname) && isFormActionRequest(event.request);
}

export const sessionActionGuard: Handle = async ({ event, resolve }) => {
  if (isSignedOutAppAction(event)) redirect(303, signinRedirectFor(event.url));
  return resolve(event);
};
