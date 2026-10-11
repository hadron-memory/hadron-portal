/**
 * The Human Team tab's three actions (#1005).
 *
 * These were the actions of the standalone `/app/apps/[appId]/members` page.
 * That page is now a redirect into the tab, so its forms post to the App page
 * instead; the handlers live here, not inline in `+page.server.ts`, because that
 * file is already the loader and eleven other actions, and because these three
 * are the only part of it that has a test of their own.
 */
import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { ENSURE_APP_MEMBER_MUTATION, REMOVE_APP_MEMBER_MUTATION } from '$lib/server/queries';
import { appMemberErrorCode, translateAppMemberError, appMemberErrorStatus } from '$lib/i18n/app-member-errors';
import { t } from '$lib/i18n/t';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

export const addAppMemberFormAdapter = zod4(addAppMemberSchema);
export const ensureAppMemberFormAdapter = zod4(ensureAppMemberSchema);
export const removeAppMemberFormAdapter = zod4(removeAppMemberSchema);

/** The slice of a SvelteKit action event these handlers read. */
interface MemberActionEvent {
  request: Request;
  params: { appId: string };
  locals: { token?: string | null };
}

export async function addMember({ request, params, locals }: MemberActionEvent) {
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
    return message(form, { type: 'error', text: errorText }, { status: appMemberErrorStatus(e) });
  }
}

export async function ensureMember({ request, params, locals }: MemberActionEvent) {
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
    return message(form, { type: 'error', text: errorText }, { status: appMemberErrorStatus(e) });
  }
}

export async function removeMember({ request, params, locals }: MemberActionEvent) {
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
}
