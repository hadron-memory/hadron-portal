import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_ORGANIZATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({});

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const slug = String(fd.get('slug') ?? '').trim();

    if (!name || !slug) return fail(400, { error: 'Name and slug are required', name, slug });
    if (!/^[a-z0-9-]+$/.test(slug)) return fail(400, { error: 'Slug must be lowercase letters, numbers, and hyphens only', name, slug });

    try {
      const data = await gqlClient(locals.token).request<{ createOrganization: { id: string } }>(
        CREATE_ORGANIZATION_MUTATION,
        { name, slug },
      );
      redirect(303, `/app/orgs/${data.createOrganization.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const msg = e instanceof Error ? e.message : 'Failed to create organization';
      return fail(500, { error: msg, name, slug });
    }
  },
};
