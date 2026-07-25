import { fail, error } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import {
  APP_WITH_MEMBERS_QUERY,
  ENSURE_APP_MEMBER_MUTATION,
  REMOVE_APP_MEMBER_MUTATION,
  ORGANIZATION_QUERY,
  USERS_QUERY,
} from '$lib/server/queries';
import { appMemberErrorCode, translateAppMemberError, appMemberErrorStatus } from '$lib/i18n/app-member-errors';
import { t } from '$lib/i18n/t';
import type { App, AppMember, Organization, UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

const addAppMemberFormAdapter = zod4(addAppMemberSchema);
const ensureAppMemberFormAdapter = zod4(ensureAppMemberSchema);
const removeAppMemberFormAdapter = zod4(removeAppMemberSchema);

export const load: PageServerLoad = async ({ params, locals }) => {
  // #648: canonical org-optional App members. No requireNonConsumer — a
  // user-owned (org-less) app has members too; the app(ref:) gate is the auth.
  const client = gqlClient(locals.token);
  const [appData, usersData] = await Promise.all([
    client
      .request<{ app: (App & { members?: AppMember[] }) | null }>(APP_WITH_MEMBERS_QUERY, {
        id: params.appId,
      })
      .catch(() => ({ app: null })),
    fetchAllItems<UserSummary>(client, USERS_QUERY, 'users')
      .catch(() => [] as UserSummary[]),
  ]);
  if (!appData.app) throw error(404, 'App not found');

  // Org chrome only for an org-owned app (breadcrumb/back link); a user-owned
  // (org-less) app has none. For an org-owned app a null/failed org lookup is a
  // real error, NOT the org-less case — 404 rather than silently mislabelling
  // the app as personal (which would point the breadcrumb at "My apps" and hide
  // org-derived controls). Mirrors the canonical detail loader.
  let org: Organization | null = null;
  if (appData.app.organizationId) {
    const orgData = await client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, {
        id: appData.app.organizationId,
      })
      .catch(() => ({ organization: null }));
    if (!orgData.organization) throw error(404, 'Organization not found');
    org = orgData.organization;
  }

  const members = appData.app.members ?? [];
  const memberIds = new Set(members.map((member) => member.userId));
  const firstNonMember = usersData.find((user) => !memberIds.has(user.id));
  const firstRole = appData.app.agent?.installationPolicy?.memberRoles?.[0] ?? '';
  const [addForm, ensureForm, removeForm] = await Promise.all([
    superValidate(
      { userId: firstNonMember?.id ?? '', role: firstRole },
      addAppMemberFormAdapter,
      { errors: false },
    ),
    superValidate(
      { userId: '', role: firstRole },
      ensureAppMemberFormAdapter,
      { errors: false },
    ),
    superValidate(
      { userId: '' },
      removeAppMemberFormAdapter,
      { errors: false },
    ),
  ]);

  return {
    app: appData.app,
    org,
    members,
    allUsers: usersData,
    addForm,
    ensureForm,
    removeForm,
  };
};

export const actions: Actions = {
  add: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), addAppMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(ENSURE_APP_MEMBER_MUTATION, {
        appId: params.appId,
        userId: form.data.userId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: t('app-member.add.success', 'Member added.') });
    } catch (e: unknown) {
      const errorText = translateAppMemberError(e, 'Failed to save member');
      if (appMemberErrorCode(e) === 'InvalidRoleError') {
        return setError(form, 'role', errorText, { status: 400 });
      }
      return message(form, { type: 'error', text: errorText }, {
        status: appMemberErrorStatus(e),
      });
    }
  },

  ensure: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), ensureAppMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(ENSURE_APP_MEMBER_MUTATION, {
        appId: params.appId,
        userId: form.data.userId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: t('app-member.update.success', 'Member updated.') });
    } catch (e: unknown) {
      const errorText = translateAppMemberError(e, 'Failed to save member');
      if (appMemberErrorCode(e) === 'InvalidRoleError') {
        return setError(form, 'role', errorText, { status: 400 });
      }
      return message(form, { type: 'error', text: errorText }, {
        status: appMemberErrorStatus(e),
      });
    }
  },

  remove: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), removeAppMemberFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_APP_MEMBER_MUTATION, {
        appId: params.appId,
        userId: form.data.userId,
      });
      return message(form, { type: 'success', text: t('app-member.remove.success', 'Member removed.') });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: translateAppMemberError(e, 'Failed to remove member') }, {
        status: appMemberErrorStatus(e),
      });
    }
  },
};
