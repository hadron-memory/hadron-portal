import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { gqlClient } from '$lib/server/api';
import {
  INVITE_BY_TOKEN_QUERY,
  ACCEPT_INVITE_BY_TOKEN_MUTATION,
} from '$lib/server/queries';
import type { OrgInvite } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const controllerUrl = env.CONTROLLER_URL ?? 'http://localhost:4000';

  // Look up the invite (unauthenticated — controller allows token lookup)
  let invite: OrgInvite | null = null;
  try {
    const result = await gqlClient(locals.token).request<{ inviteByToken: OrgInvite }>(
      INVITE_BY_TOKEN_QUERY, { token: params.token },
    );
    invite = result.inviteByToken;
  } catch {
    // invalid or expired token
  }

  const signInUrl = `${controllerUrl}/auth/github?redirect=${encodeURIComponent(url.pathname)}`;

  return {
    invite,
    token: params.token,
    isAuthenticated: !!locals.user,
    signInUrl,
  };
};

export const actions: Actions = {
  accept: async ({ params, locals }) => {
    if (!locals.token) return fail(401, { error: 'You must sign in first' });
    try {
      await gqlClient(locals.token).request(ACCEPT_INVITE_BY_TOKEN_MUTATION, { token: params.token });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to accept invite' });
    }
    redirect(303, '/app/dashboard');
  },
};
