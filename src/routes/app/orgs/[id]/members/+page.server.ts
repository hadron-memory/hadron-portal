import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  ADD_MEMBER_MUTATION,
  UPDATE_MEMBER_MUTATION,
  REMOVE_MEMBER_MUTATION,
  CREATE_USER_INVITATION_MUTATION,
} from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { inviteMemberSchema } from './schema';

const inviteMemberFormAdapter = zod4(inviteMemberSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  // The "Add existing user" picker searches on demand via /api/users/search —
  // we deliberately no longer bulk-load every user (with their emails) into the
  // page just to populate a dropdown (#414 privacy).
  const orgData = await client.request<{ organization: Organization }>(ORGANIZATION_QUERY, {
    id: params.id,
  });
  return {
    org: orgData.organization,
    currentUserId: locals.user?.id ?? null,
    inviteForm: await superValidate({}, inviteMemberFormAdapter, { errors: false }),
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
    const form = await superValidate(await request.formData(), inviteMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || null;
    const email = form.data.email || null;
    const memberRole = form.data.memberRole;

    try {
      const data = await gqlClient(locals.token).request<{
        createUserInvitation: { slug: string };
      }>(CREATE_USER_INVITATION_MUTATION, {
        orgId: params.id,
        memberRole,
        name,
        email,
        maxActivations: 1,
        expiresInDays: 30,
      });
      const inviteUrl = `${url.origin}/invite/${data.createUserInvitation.slug}`;
      // Surface who the link is for so the success message can name them
      // (name preferred, email as fallback, null when neither was given).
      return { form, inviteUrl, inviteName: name ?? email };
    } catch (e: unknown) {
      return message(form, extractGqlError(e, 'Failed to create invitation'), { status: 500 });
    }
  },

  leave: async ({ params, locals }) => {
    if (!locals.user?.id) return fail(401, { error: 'Not authenticated' });
    try {
      await gqlClient(locals.token).request(REMOVE_MEMBER_MUTATION, { orgId: params.id, userId: locals.user.id });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to leave organization' });
    }
    redirect(303, '/app/orgs');
  },
};
