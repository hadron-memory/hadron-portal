import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_ORGANIZATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { createOrganizationSchema } from './schema';

const createOrganizationFormAdapter = zod4(createOrganizationSchema);

export const load: PageServerLoad = async ({ parent, url }) => {
  await requireNonConsumer(parent);
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
      const msg = e instanceof Error ? e.message : 'Failed to create organization';
      return message(form, { type: 'error', text: msg }, { status: 500 });
    }
  },
};
