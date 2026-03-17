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
    // Token is invalid or backend is unreachable — clear stale cookie
    cookies.delete('hadron_token', { path: '/' });
    locals.token = null;
    locals.user = null;
    return { user: null };
  }
};
