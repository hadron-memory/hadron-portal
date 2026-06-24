import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { EFFECTIVE_ACCESS_QUERY } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { normalizeUserRef } from '$lib/components/commands/command-field';
import type { EffectiveAccess } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// #375 — "Check access" command page. Web equivalent of the CLI
// `hadron access check <user> <resource>`, backed by the effectiveAccess query.
// The shared /app/commands layout renders `command.title` + `.description`.

const COMMAND = {
  id: 'access-check',
  title: 'Check access',
  description:
    "Show a user's effective access to a resource — the read/write/manage/delete capabilities and the grants that confer them.",
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
  return {
    command: COMMAND,
    // Prefill from a deep link (e.g. the command bar or a copied URL).
    prefill: {
      user: (url.searchParams.get('user') ?? '').trim() || selfRef,
      resource: (url.searchParams.get('resource') ?? '').trim(),
    },
  };
};

export const actions: Actions = {
  run: async ({ request, locals }) => {
    const fd = await request.formData();
    const userRaw = String(fd.get('user') ?? '').trim();
    const resource = String(fd.get('resource') ?? '').trim();

    // Echo the submitted values back so the form stays populated on re-render.
    const submitted = { user: userRaw, resource };

    if (!userRaw || !resource) {
      return fail(400, { ...submitted, error: 'Enter both a user and a resource.' });
    }

    const user = normalizeUserRef(userRaw);

    try {
      const { effectiveAccess } = await gqlClient(locals.token).request<{
        effectiveAccess: EffectiveAccess;
      }>(EFFECTIVE_ACCESS_QUERY, { user, resource });
      return { ...submitted, result: effectiveAccess };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      if (code === 'FORBIDDEN') {
        return fail(403, {
          ...submitted,
          error:
            "You're not allowed to audit access to this resource. You can check your own access, or any resource you can see.",
        });
      }
      if (code === 'URN_NOT_QUALIFIED') {
        // A malformed / unqualified ref — the server rejects it before
        // resolution, so it's a fixable input error, not a server failure.
        return fail(400, {
          ...submitted,
          error:
            "That doesn't look like a fully-qualified reference. Use @handle or a user id for the user, and a hrn:<type>: URN (copied from the resource’s page) for the resource.",
        });
      }
      if (code === 'NOT_FOUND') {
        // The server distinguishes "User not found" vs "Resource not found";
        // surface that so the user knows which input to fix.
        const which = extractGqlError(e, 'Not found');
        const hint = /user/i.test(which)
          ? ' Check the handle — yours is on your account page (try @handle or a user id).'
          : ' Check the resource URN — copy it from the resource’s page.';
        return fail(404, { ...submitted, error: which + '.' + hint });
      }
      return fail(500, { ...submitted, error: extractGqlError(e, 'Access check failed.') });
    }
  },
};
