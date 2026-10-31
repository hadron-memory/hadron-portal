import { extractGqlError } from '$lib/server/gqlError';
import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { CREATE_ORGANIZATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { createOrganizationSchema } from './schema';

const createOrganizationFormAdapter = zod4(createOrganizationSchema);

// #1028: NO `requireNonConsumer` here. "Consumer mode" means a member of zero
// organizations, which is every new user, and that guard bounces them off
// org-scoped surfaces. Creating an organization is how a user stops being one,
// so guarding this page blocked the only way out: "Create organization" sent a
// new user to My memories without a word. The server lets any signed-in user
// create an org and makes them its OWNER (hadron-server `createOrganization`:
// `requireRole(ctx, 'READER')`, a role every sign-up holds), so the portal
// matches the CLI (`hadron org create`). The /app layout's sign-in redirect
// still applies.
// Holger chose this over gating org creation for individuals.
export const load: PageServerLoad = async ({ url }) => {
  // #320: the header command bar (Create mode) can deep-link here with the URN
  // slug prefilled (`?urn=<slug>`).
  const prefillUrn = (url.searchParams.get('urn') ?? '').trim();
  const form = await superValidate({ urn: prefillUrn }, createOrganizationFormAdapter, { errors: false });
  return { prefillUrn, form };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), createOrganizationFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      const data = await gqlClient(locals.token).request<{ createOrganization: { id: string } }>(
        CREATE_ORGANIZATION_MUTATION,
        { name: form.data.name, urn: form.data.urn },
      );
      redirect(303, `/app/orgs/${data.createOrganization.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const msg = extractGqlError(e, 'Failed to create organization');
      return message(form, { type: 'error', text: msg }, { status: 500 });
    }
  },
};
