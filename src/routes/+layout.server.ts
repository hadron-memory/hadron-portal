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
    // Which cookie is stale depends on which one backed locals.token: under
    // impersonation that is `hadron_impersonation`, so deleting hadron_token
    // here would sign the ADMIN out over a revoked/demoted impersonation
    // session and leave the orphaned impersonation cookie behind (PR #692
    // review, P1). Dropping the impersonation cookie instead restores the
    // admin's untouched session on the very next request.
    if (locals.impersonation) {
      cookies.delete('hadron_impersonation', { path: '/' });
      locals.impersonation = null;
    } else {
      cookies.delete('hadron_token', { path: '/' });
    }
    locals.token = null;
    locals.user = null;
    return { user: null };
  }
};
