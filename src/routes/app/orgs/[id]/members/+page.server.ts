import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  ORGANIZATION_QUERY,
  USERS_QUERY,
  ADD_MEMBER_MUTATION,
  UPDATE_MEMBER_MUTATION,
  REMOVE_MEMBER_MUTATION,
} from '$lib/server/queries';
import type { Organization, UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const [orgData, usersData] = await Promise.all([
    client.request<{ organization: Organization }>(ORGANIZATION_QUERY, { id: params.id }),
    client.request<{ users: UserSummary[] }>(USERS_QUERY).catch(() => ({ users: [] as UserSummary[] })),
  ]);
  return {
    org: orgData.organization,
    allUsers: usersData.users,
    currentUserId: locals.user?.id ?? null,
  };
};

export const actions: Actions = {
  add: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const userId = String(fd.get('userId') ?? '');
    const role = String(fd.get('role') ?? 'READER');
    if (!userId) return fail(400, { error: 'User is required' });
    try {
      await gqlClient(locals.token).request(ADD_MEMBER_MUTATION, { orgId: params.id, userId, role });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add member' });
    }
  },

  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const userId = String(fd.get('userId') ?? '');
    const role = String(fd.get('role') ?? 'READER');
    try {
      await gqlClient(locals.token).request(UPDATE_MEMBER_MUTATION, { orgId: params.id, userId, role });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update member' });
    }
  },

  remove: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const userId = String(fd.get('userId') ?? '');
    try {
      await gqlClient(locals.token).request(REMOVE_MEMBER_MUTATION, { orgId: params.id, userId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to remove member' });
    }
  },
};
