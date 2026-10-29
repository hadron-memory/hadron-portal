import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ADD_MEMBER_MUTATION,
  UPDATE_MEMBER_MUTATION,
  REMOVE_MEMBER_MUTATION,
  CREATE_USER_INVITATION_MUTATION,
  START_IMPERSONATION_MUTATION,
  ORG_MEMBERS_TAB_QUERY,
} from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  addOrgMemberSchema,
  impersonateMemberSchema,
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
const impersonateMemberFormAdapter = zod4(impersonateMemberSchema);

// #1297: each form carries an explicit Superforms id (its _kind). The default id hashes the
// schema's SHAPE, so same-shaped forms (Remove/Impersonate, Add/Update) shared one client
// store. The actions answer under the same id, or the client would ignore their result.
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  // The "Add existing user" picker searches on demand via /api/users/search —
  // we deliberately no longer bulk-load every user (with their emails) into the
  // page just to populate a dropdown (#414 privacy).
  const orgData = await client.request<{ organization: Organization }>(ORG_MEMBERS_TAB_QUERY, {
    ref: params.id,
  });
  const [addForm, updateForm, removeForm, inviteForm, leaveForm, impersonateForm] =
    await Promise.all([
      superValidate({}, addOrgMemberFormAdapter, { errors: false, id: 'addOrgMember' }),
      superValidate({}, updateOrgMemberFormAdapter, { errors: false, id: 'updateOrgMember' }),
      superValidate({}, removeOrgMemberFormAdapter, { errors: false, id: 'removeOrgMember' }),
      superValidate({}, inviteMemberFormAdapter, { errors: false, id: 'inviteOrgMember' }),
      superValidate({}, leaveOrgFormAdapter, { errors: false, id: 'leaveOrg' }),
      superValidate({}, impersonateMemberFormAdapter, { errors: false, id: 'impersonateMember' }),
    ]);
  return {
    org: orgData.organization,
    currentUserId: locals.user?.id ?? null,
    isImpersonating: locals.impersonation !== null,
    addForm,
    updateForm,
    removeForm,
    inviteForm,
    leaveForm,
    impersonateForm,
  };
};

export const actions: Actions = {
  add: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), addOrgMemberFormAdapter, { id: 'addOrgMember' });
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
    const form = await superValidate(await request.formData(), updateOrgMemberFormAdapter, { id: 'updateOrgMember' });
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
    const form = await superValidate(await request.formData(), removeOrgMemberFormAdapter, { id: 'removeOrgMember' });
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
    const form = await superValidate(await request.formData(), inviteMemberFormAdapter, { id: 'inviteOrgMember' });
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

  // Admin impersonation: start a read-only session as the selected member.
  // Runs with the ADMIN's token; the returned short-TTL impersonation JWT is
  // seated in its own httpOnly cookie (hadron_token stays the admin's, so
  // stopping restores their session without re-login). The server enforces
  // every gate (org role, peer-or-below, liveness) — a failed start surfaces
  // as a form error.
  impersonate: async ({ request, params, locals, cookies }) => {
    const form = await superValidate(await request.formData(), impersonateMemberFormAdapter, { id: 'impersonateMember' });
    if (!form.valid) return fail(400, { form });
    if (locals.impersonation) {
      return message(
        form,
        { type: 'error', text: 'Already impersonating — stop the current session first.' },
        { status: 400 },
      );
    }

    let result: {
      startImpersonation: { token: string; session: { id: string; expiresAt: string } };
    };
    try {
      result = await gqlClient(locals.token).request(START_IMPERSONATION_MUTATION, {
        orgRef: params.id,
        userRef: form.data.userId,
        reason: 'portal member-page impersonation',
      });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to start impersonation') },
        { status: 500 },
      );
    }
    const { token, session } = result.startImpersonation;
    const maxAge = Math.max(
      60,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    );
    cookies.set('hadron_impersonation', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
    });
    redirect(303, `/app/orgs/${params.id}`);
  },

  leave: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), leaveOrgFormAdapter, { id: 'leaveOrg' });
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
