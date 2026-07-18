import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { INVITE_USER_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { accountInviteSchema } from './schema';

const accountInviteFormAdapter = zod4(accountInviteSchema);

// #339: the command bar can deep-link `invite <email>` here with the email
// prefilled, so the user only has to click submit.
export const load: PageServerLoad = async ({ url }) => {
  const prefillEmail = (url.searchParams.get('email') ?? '').trim();
  return {
    prefillEmail,
    form: await superValidate({ inviteEmail: prefillEmail }, accountInviteFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  // #327 follow-up: moved here from /app/account so "Invite" is its own tab.
  invite: async ({ request, locals, url }) => {
    const form = await superValidate(await request.formData(), accountInviteFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.inviteName || null;
    const email = form.data.inviteEmail || null;
    const githubUsername = form.data.inviteGithub || null;
    try {
      const data = await gqlClient(locals.token).request<{ inviteUser: { slug: string } }>(
        INVITE_USER_MUTATION,
        { name, email, githubUsername, maxActivations: 1, expiresInDays: 30 },
      );
      const inviteUrl = `${url.origin}/invite/${data.inviteUser.slug}`;
      return { form, invited: true, inviteUrl };
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to send invitation') }, { status: 500 });
    }
  },
};
