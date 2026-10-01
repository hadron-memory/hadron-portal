import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import {
  CREATE_REGISTER_ENTRY_MUTATION,
  DELETE_REGISTER_ENTRY_MUTATION,
  UPDATE_REGISTER_ENTRY_MUTATION,
} from '$lib/server/queries';
import { t } from '$lib/i18n/t';
import { addAttendanceSchema, editAttendanceSchema, removeAttendanceSchema } from '$lib/register/schema';

/**
 * #942 — the register's three writes, shared by the App Channels page (App-owned
 * rows) and the organization's Channels page (org-owned rows).
 *
 * The owner is the ONLY difference between the two, and it is decided here from
 * the route, never from the form: a row is created for the page's own App or
 * organization. Every write runs under the caller's token, so the server's
 * owner gates (`lib/register.ts`: App ADMIN for App rows, org CONTRIBUTOR+ for
 * org rows) decide what succeeds. The page only chooses what to offer.
 */

type RegisterActionEvent = {
  request: Request;
  params: Record<string, string>;
  locals: App.Locals;
};

/** The words for a refused register write: the codes lib/register.ts emits, else the server's own. */
export function registerErrorText(e: unknown, fallback: string, op: 'add' | 'change' = 'change'): string {
  switch (extractGqlErrorCode(e)) {
    case 'REGISTER_ENTRY_EXISTS':
      return t('app.channels.register.error.exists', 'That attendee already takes part in that channel. Edit the existing row instead.');
    case 'NOT_FOUND':
      // An add has no row yet: what went missing is the chosen channel or attendee.
      return op === 'add'
        ? t('app.channels.register.error.add-not-found', 'That channel or attendee is not available to you. Reload the page and pick again.')
        : t('app.channels.register.error.not-found', 'That row is not available to you.');
    case 'FORBIDDEN':
      return t('app.channels.register.error.forbidden', 'You can’t change attendance for these channels.');
    default:
      return extractGqlError(e, fallback);
  }
}

/** The three empty register forms a page's loader returns. */
export async function registerForms() {
  return {
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
  };
}

/**
 * The add / edit / remove actions for a page whose owner is `ownerRefOf(params)`.
 * Edit and remove address a row by its ref; the server refuses a row the caller
 * may not change, whichever page the POST came from.
 */
export function attendanceActions(ownerRefOf: (params: Record<string, string>) => string) {
  return {
    addAttendance: async ({ request, params, locals }: RegisterActionEvent) => {
      const form = await superValidate(await request.formData(), zod4(addAttendanceSchema));
      if (!form.valid) return fail(400, { form });
      try {
        await gqlClient(locals.token).request(CREATE_REGISTER_ENTRY_MUTATION, {
          input: {
            ownerRef: ownerRefOf(params),
            channelRef: form.data.channelId,
            // Empty = every attendee in the owner's context; the server resolves
            // a Worker first, then an installed Agent, and refuses anything else.
            attendeeRef: form.data.attendee || null,
            role: form.data.role,
            mentionOnly: form.data.mentionOnly,
            description: form.data.description || null,
          },
        });
      } catch (e) {
        return message(form, { type: 'error', text: registerErrorText(e, t('app.channels.register.error.added', 'The attendance could not be added.'), 'add') }, { status: 400 });
      }
      return message(form, { type: 'success', text: t('app.channels.register.added', 'Attendance added.') });
    },

    editAttendance: async ({ request, locals }: RegisterActionEvent) => {
      const form = await superValidate(await request.formData(), zod4(editAttendanceSchema));
      if (!form.valid) return fail(400, { form });
      try {
        await gqlClient(locals.token).request(UPDATE_REGISTER_ENTRY_MUTATION, {
          ref: form.data.ref,
          input: { role: form.data.role, mentionOnly: form.data.mentionOnly, description: form.data.description },
        });
      } catch (e) {
        return message(form, { type: 'error', text: registerErrorText(e, t('app.channels.register.error.updated', 'The attendance could not be updated.')) }, { status: 400 });
      }
      return message(form, { type: 'success', text: t('app.channels.register.updated', 'Attendance updated.') });
    },

    removeAttendance: async ({ request, locals }: RegisterActionEvent) => {
      const form = await superValidate(await request.formData(), zod4(removeAttendanceSchema));
      if (!form.valid) return fail(400, { form });
      try {
        await gqlClient(locals.token).request(DELETE_REGISTER_ENTRY_MUTATION, { ref: form.data.ref });
      } catch (e) {
        return message(form, { type: 'error', text: registerErrorText(e, t('app.channels.register.error.removed', 'The attendance could not be removed.')) }, { status: 400 });
      }
      return message(form, { type: 'success', text: t('app.channels.register.removed', 'Attendance removed.') });
    },
  };
}
