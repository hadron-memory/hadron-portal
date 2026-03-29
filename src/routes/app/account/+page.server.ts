import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ME_QUERY, UPDATE_MY_PROFILE_MUTATION, INVITE_USER_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ me: Record<string, unknown> | null }>(ME_QUERY)
    .catch(() => ({ me: null }));
  return { user: data.me ?? locals.user };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || null;
    const handle = String(fd.get('handle') ?? '').trim() || null;
    const email = String(fd.get('email') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPDATE_MY_PROFILE_MUTATION, { name, handle, email });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update profile' });
    }
  },

  invite: async ({ request, locals, url }) => {
    const fd = await request.formData();
    const name = String(fd.get('inviteName') ?? '').trim() || null;
    const email = String(fd.get('inviteEmail') ?? '').trim() || null;
    const githubUsername = String(fd.get('inviteGithub') ?? '').trim() || null;
    try {
      const data = await gqlClient(locals.token).request<{ inviteUser: { slug: string } }>(
        INVITE_USER_MUTATION,
        { name, email, githubUsername, maxActivations: 1, expiresInDays: 30 },
      );
      const inviteUrl = `${url.origin}/invite/${data.inviteUser.slug}`;
      return { invited: true, inviteUrl };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to send invitation' });
    }
  },
};
