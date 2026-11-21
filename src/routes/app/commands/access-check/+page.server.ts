import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { EFFECTIVE_ACCESS_QUERY } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { normalizeUserRef } from '$lib/components/commands/command-field';
import { t } from '$lib/i18n/t';
import type { EffectiveAccess } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { accessCheckSchema } from './schema';

const accessCheckFormAdapter = zod4(accessCheckSchema);
type AccessCheckForm = Infer<typeof accessCheckSchema, 'zod4'>;

// #375 — "Check access" command page. Web equivalent of the CLI
// `hadron access check <user> <resource>`, backed by the effectiveAccess query.
// The shared /app/commands layout renders `command.title` + `.description`.

// Getters (not eager `t()` values): the module is initialized once on the
// server, so eager calls would freeze the copy to the startup locale. Getters
// re-evaluate t() when `command` is serialized in load() — i.e. per request.
const COMMAND = {
  id: 'access-check',
  get title() {
    return t('commands.access-check.title', 'Check access');
  },
  get description() {
    return t(
      'commands.access-check.description',
      "Show a user's effective access to a resource — the read/write/manage/delete capabilities and the grants that confer them.",
    );
  },
};

export const load: PageServerLoad = async ({ url, parent }) => {
  // Default the subject to the signed-in user (the common "what can I access?"
  // case), unless a deep link overrides it. The /app layout already resolved
  // the full profile, so the handle is on parent().user.
  const { user } = await parent();
  // Default the subject to the signed-in user: @handle if they have one, else
  // their user id (effectiveAccess accepts either), so the self-audit default
  // still works for a handle-less account.
  const selfRef = user?.handle ? `@${user.handle}` : (user?.id ?? '');
  const prefill = {
    user: (url.searchParams.get('user') ?? '').trim() || selfRef,
    resource: (url.searchParams.get('resource') ?? '').trim(),
  };
  return {
    command: COMMAND,
    // Prefill from a deep link (e.g. the command bar or a copied URL).
    prefill,
    form: await superValidate<AccessCheckForm>(prefill, accessCheckFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  run: async ({ request, locals }) => {
    const form = await superValidate<AccessCheckForm>(
      await request.formData(),
      accessCheckFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const user = normalizeUserRef(form.data.user);
    const resource = form.data.resource;

    try {
      const { effectiveAccess } = await gqlClient(locals.token).request<{
        effectiveAccess: EffectiveAccess;
      }>(EFFECTIVE_ACCESS_QUERY, { user, resource });
      return {
        result: effectiveAccess,
        ...message(form, { type: 'success', text: t('commands.access-check.success', 'Access check complete.') }),
      };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      if (code === 'FORBIDDEN') {
        return message(
          form,
          {
            type: 'error',
            text: t(
              'commands.access-check.error.forbidden',
              "You're not allowed to audit access to this resource. You can check your own access, or any resource you can see.",
            ),
          },
          { status: 403 },
        );
      }
      if (code === 'URN_NOT_QUALIFIED') {
        // A malformed / unqualified ref — the server rejects it before
        // resolution, so it's a fixable input error, not a server failure.
        return message(
          form,
          {
            type: 'error',
            text: t(
              'commands.access-check.error.unqualified',
              "That doesn't look like a fully-qualified reference. Use @handle or a user id for the user, and a hrn:<type>: URN (copied from the resource’s page) for the resource.",
            ),
          },
          { status: 400 },
        );
      }
      if (code === 'NOT_FOUND') {
        // The server distinguishes "User not found" vs "Resource not found";
        // surface that so the user knows which input to fix.
        const which = extractGqlError(e, t('commands.common.not-found', 'Not found'), ['NOT_FOUND']);
        const hint = /user/i.test(which)
          ? t('commands.access-check.not-found.user-hint', ' Check the handle — yours is on your account page (try @handle or a user id).')
          : t('commands.access-check.not-found.resource-hint', ' Check the resource URN — copy it from the resource’s page.');
        return message(form, { type: 'error', text: which + '.' + hint }, { status: 404 });
      }
      return message(
        form,
        { type: 'error', text: extractGqlError(e, t('commands.access-check.error.failed', 'Access check failed.')) },
        { status: 500 },
      );
    }
  },
};
