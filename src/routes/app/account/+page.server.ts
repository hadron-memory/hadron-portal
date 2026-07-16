import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ME_QUERY, UPDATE_MY_PROFILE_MUTATION } from '$lib/server/queries';
import { validateHandleField } from '$lib/urn/form-validation';
import type { UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ me: UserSummary | null }>(ME_QUERY)
    .catch(() => ({ me: null as UserSummary | null }));
  const user: UserSummary = data.me ?? { ...locals.user!, handle: null };
  return { user };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || null;
    const handle = String(fd.get('handle') ?? '').trim() || null;
    const email = String(fd.get('email') ?? '').trim() || null;
    const handleError = validateHandleField(handle ?? '');
    if (handleError) return fail(400, { error: handleError, name, handle, email });
    try {
      await gqlClient(locals.token).request(UPDATE_MY_PROFILE_MUTATION, { name, handle, email });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update profile' });
    }
  },
};
