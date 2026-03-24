import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { INVITATION_QUERY, ACCEPT_INVITATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const slug = params.token;

  // Fetch invitation details (public — no auth required to view)
  const client = gqlClient(locals.token);
  let invitation = null;
  try {
    const data = await client.request<{ invitation: unknown }>(INVITATION_QUERY, { slug });
    invitation = data.invitation;
  } catch { /* ignore */ }

  return {
    invitation,
    isSignedIn: !!locals.user,
    slug,
  };
};

export const actions: Actions = {
  accept: async ({ params, locals }) => {
    if (!locals.user || !locals.token) {
      return fail(401, { error: 'You must be signed in to accept this invitation' });
    }

    try {
      await gqlClient(locals.token).request(ACCEPT_INVITATION_MUTATION, { slug: params.token });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to accept invitation' });
    }

    redirect(303, '/app/dashboard');
  },
};
