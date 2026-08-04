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
import {
  addOrgMemberSchema,
  inviteMemberSchema,
  leaveOrgSchema,
  removeOrgMemberSchema,
  updateOrgMemberSchema,
} from './schema';

const addOrgMemberFormAdapter = zod4(addOrgMemberSchema);
const updateOrgMemberFormAdapter = zod4(updateOrgMemberSchema);
const removeOrgMemberFormAdapter = zod4(removeOrgMemberSchema);
const leaveOrgFormAdapter = zod4(leaveOrgSchema);
const inviteMemberFormAdapter = zod4(inviteMemberSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  // The "Add existing user" picker searches on demand via /api/users/search —
  // we deliberately no longer bulk-load every user (with their emails) into the
  // page just to populate a dropdown (#414 privacy).
  const orgData = await client.request<{ organization: Organization }>(ORGANIZATION_QUERY, {
    ref: params.id,
  });
  const [addForm, updateForm, removeForm, inviteForm, leaveForm] = await Promise.all([
    superValidate({}, addOrgMemberFormAdapter, { errors: false }),
    superValidate({}, updateOrgMemberFormAdapter, { errors: false }),
    superValidate({}, removeOrgMemberFormAdapter, { errors: false }),
    superValidate({}, inviteMemberFormAdapter, { errors: false }),
    superValidate({}, leaveOrgFormAdapter, { errors: false }),
  ]);
  return {
    org: orgData.organization,
    currentUserId: locals.user?.id ?? null,
    addForm,
    updateForm,
    removeForm,
    inviteForm,
    leaveForm,
  };
};

export const actions: Actions = {
  add: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), addOrgMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(ADD_MEMBER_MUTATION, {
        orgId: params.id,
        userId: form.data.userId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: 'Member added.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to add member') }, { status: 500 });
    }
  },

  update: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), updateOrgMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_MEMBER_MUTATION, {
        orgId: params.id,
        userId: form.data.userId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: 'Member updated.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update member') }, { status: 500 });
    }
  },

  remove: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), removeOrgMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_MEMBER_MUTATION, {
        orgId: params.id,
        userId: form.data.userId,
      });
      return message(form, { type: 'success', text: 'Member removed.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to remove member') }, { status: 500 });
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
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to create invitation') }, { status: 500 });
    }
  },

  leave: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), leaveOrgFormAdapter);
    if (!locals.user?.id) return message(form, { type: 'error', text: 'Not authenticated' }, { status: 401 });
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_MEMBER_MUTATION, { orgId: params.id, userId: locals.user.id });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to leave organization') }, { status: 500 });
    }
    redirect(303, '/app/orgs');
  },
};
