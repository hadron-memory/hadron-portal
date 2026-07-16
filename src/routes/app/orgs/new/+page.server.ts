import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_ORGANIZATION_MUTATION } from '$lib/server/queries';
import { validateOrgSlugField } from '$lib/urn/form-validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
  await requireNonConsumer(parent);
  // #320: the header command bar (Create mode) can deep-link here with the URN
  // slug prefilled (`?urn=<slug>`).
  return { prefillUrn: (url.searchParams.get('urn') ?? '').trim() };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const urn = String(fd.get('urn') ?? '').trim();

    if (!name || !urn) return fail(400, { error: 'Name and URN are required', name, urn });
    const urnError = validateOrgSlugField(urn);
    if (urnError) return fail(400, { error: urnError, name, urn });

    try {
      const data = await gqlClient(locals.token).request<{ createOrganization: { id: string } }>(
        CREATE_ORGANIZATION_MUTATION,
        { name, urn },
      );
      redirect(303, `/app/orgs/${data.createOrganization.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const msg = e instanceof Error ? e.message : 'Failed to create organization';
      return fail(500, { error: msg, name, urn });
    }
  },
};
