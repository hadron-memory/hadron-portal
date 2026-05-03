import { fail, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  APP_WITH_MEMBERS_QUERY,
  ENSURE_APP_MEMBER_MUTATION,
  REMOVE_APP_MEMBER_MUTATION,
  ORGANIZATION_QUERY,
  USERS_QUERY,
} from '$lib/server/queries';
import { translateAppMemberError } from '$lib/i18n/app-member-errors';
import type { App, AppMember, Organization, UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [appData, orgData, usersData] = await Promise.all([
    client
      .request<{ app: (App & { members?: AppMember[] }) | null }>(APP_WITH_MEMBERS_QUERY, {
        id: params.appId,
      })
      .catch(() => ({ app: null })),
    client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => ({ organization: null })),
    client
      .request<{ users: UserSummary[] }>(USERS_QUERY)
      .catch(() => ({ users: [] as UserSummary[] })),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  if (!orgData.organization) throw error(404, 'Organization not found');

  return {
    app: appData.app,
    org: orgData.organization,
    members: appData.app.members ?? [],
    allUsers: usersData.users,
  };
};

export const actions: Actions = {
  ensure: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const userId = String(fd.get('userId') ?? '');
    const role = String(fd.get('role') ?? '').trim();
    if (!userId) return fail(400, { error: 'User is required' });
    if (!role) return fail(400, { error: 'Role is required' });
    try {
      await gqlClient(locals.token).request(ENSURE_APP_MEMBER_MUTATION, {
        appId: params.appId,
        userId,
        role,
      });
      return { ensured: true };
    } catch (e: unknown) {
      return fail(400, { error: translateAppMemberError(e, 'Failed to add member') });
    }
  },

  remove: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const userId = String(fd.get('userId') ?? '');
    if (!userId) return fail(400, { error: 'User is required' });
    try {
      await gqlClient(locals.token).request(REMOVE_APP_MEMBER_MUTATION, {
        appId: params.appId,
        userId,
      });
      return { removed: true };
    } catch (e: unknown) {
      return fail(400, { error: translateAppMemberError(e, 'Failed to remove member') });
    }
  },
};
