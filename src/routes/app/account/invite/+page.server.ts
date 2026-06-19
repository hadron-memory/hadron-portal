import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { INVITE_USER_MUTATION } from '$lib/server/queries';
import type { Actions } from './$types';

export const actions: Actions = {
  // #327 follow-up: moved here from /app/account so "Invite" is its own tab.
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
