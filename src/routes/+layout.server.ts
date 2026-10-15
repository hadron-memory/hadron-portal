import { gqlClient } from '$lib/server/api';
import { ME_QUERY } from '$lib/server/queries';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  if (!locals.token) {
    return { user: null };
  }

  try {
    const api = gqlClient(locals.token);
    const data = await api.request<{
      me: {
        id: string;
        githubUsername: string | null;
        name: string | null;
        avatarUrl: string | null;
        email: string | null;
        roles: string[];
      };
    }>(ME_QUERY);
    return { user: data.me };
  } catch {
    // Token is invalid or backend is unreachable — clear the stale cookie.
    // (Whether a 5xx should end the session at all is portal#1120.)
    // Which cookie is stale depends on which one backed locals.token: under
    // impersonation that is `hadron_impersonation`, so deleting hadron_token
    // here would sign the ADMIN out over a revoked/demoted impersonation
    // session and leave the orphaned impersonation cookie behind (PR #692
    // review, P1). Dropping the impersonation cookie instead restores the
    // admin's untouched session on the very next request.
    if (locals.impersonation) {
      cookies.delete('hadron_impersonation', { path: '/' });
    } else {
      cookies.delete('hadron_token', { path: '/' });
    }
    // #1117: and leave `locals` as hooks set it. Every other load of this
    // request runs IN PARALLEL with this one and reads `locals.token`/`.user`/
    // `.impersonation`; nulling them here changed the request under those
    // loads mid-flight (the App layout threw on `locals.user.id`; the App
    // detail page asked for its org with no token and answered 404), and a load
    // that awaited `parent()` first always saw the cleared values. The cookie
    // going is what ends the session, from the next request on.
    // `sessionCleared` says so to the App layout (#1117, Atilla's P2-2): only
    // after a drop does a reload of the same URL come back different, so only
    // then may it redirect to itself. A `me` of null (above) drops nothing.
    return { user: null, sessionCleared: true };
  }
};
