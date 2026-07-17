import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { ME_QUERY, UPDATE_MY_PROFILE_MUTATION } from '$lib/server/queries';
import type { UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { accountProfileSchema } from './schema';

const accountProfileFormAdapter = zod4(accountProfileSchema);

function profileFormDefaults(user: UserSummary) {
  return {
    name: user.name ?? '',
    handle: user.handle ?? user.githubUsername ?? '',
    email: user.email ?? '',
  };
}

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ me: UserSummary | null }>(ME_QUERY)
    .catch(() => ({ me: null as UserSummary | null }));
  const user: UserSummary = data.me ?? { ...locals.user!, handle: null };
  const form = await superValidate(profileFormDefaults(user), accountProfileFormAdapter, { errors: false });
  return { user, form };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), accountProfileFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || null;
    const handle = form.data.handle || null;
    const email = form.data.email || null;
    try {
      await gqlClient(locals.token).request(UPDATE_MY_PROFILE_MUTATION, { name, handle, email });
      return message(form, 'Profile updated.');
    } catch (e: unknown) {
      return message(form, e instanceof Error ? e.message : 'Failed to update profile', { status: 500 });
    }
  },
};
