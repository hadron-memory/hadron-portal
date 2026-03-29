import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ME_QUERY, UPDATE_MY_PROFILE_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // Load fresh user data from API (not from JWT which may be stale)
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
};
