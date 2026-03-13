import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  ORGANIZATION_QUERY,
  USERS_QUERY,
  ORGANIZATION_INVITES_QUERY,
  ADD_MEMBER_MUTATION,
  UPDATE_MEMBER_MUTATION,
  REMOVE_MEMBER_MUTATION,
  CREATE_ORGANIZATION_INVITE_MUTATION,
  CANCEL_INVITE_MUTATION,
  TRANSFER_ORGANIZATION_OWNERSHIP_MUTATION,
} from '$lib/server/queries';
import type { Organization, UserSummary, OrgInvite } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const [orgData, usersData, invitesData] = await Promise.all([
    client.request<{ organization: Organization }>(ORGANIZATION_QUERY, { id: params.id }),
    client.request<{ users: UserSummary[] }>(USERS_QUERY).catch(() => ({ users: [] as UserSummary[] })),
    client.request<{ organizationInvites: OrgInvite[] }>(ORGANIZATION_INVITES_QUERY, { orgId: params.id }).catch(() => ({ organizationInvites: [] as OrgInvite[] })),
  ]);
  return {
    org: orgData.organization,
    allUsers: usersData.users,
    invites: invitesData.organizationInvites,
    currentUserId: locals.user?.id ?? null,
    canInvite: locals.user?.canInvite ?? false,
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

  invite: async ({ request, params, locals, url }) => {
    const fd = await request.formData();
    const email = String(fd.get('email') ?? '').trim();
    if (!email) return fail(400, { error: 'Email is required' });
    try {
      const result = await gqlClient(locals.token).request<{ createOrganizationInvite: OrgInvite }>(
        CREATE_ORGANIZATION_INVITE_MUTATION, { orgId: params.id, email },
      );
      const invite = result.createOrganizationInvite;
      const inviteLink = `${url.origin}/invite/${invite.token}`;
      return { inviteLink };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to send invite' });
    }
  },

  cancelInvite: async ({ request, locals }) => {
    const fd = await request.formData();
    const inviteId = String(fd.get('inviteId') ?? '');
    try {
      await gqlClient(locals.token).request(CANCEL_INVITE_MUTATION, { inviteId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to cancel invite' });
    }
  },

  transferOwnership: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const newOwnerId = String(fd.get('newOwnerId') ?? '');
    if (!newOwnerId) return fail(400, { error: 'New owner is required' });
    try {
      await gqlClient(locals.token).request(TRANSFER_ORGANIZATION_OWNERSHIP_MUTATION, { orgId: params.id, newOwnerId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to transfer ownership' });
    }
  },
};
