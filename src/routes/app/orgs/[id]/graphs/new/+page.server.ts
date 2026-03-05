import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_GRAPH_CONFIG_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => ({ orgId: params.id });

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const source = String(fd.get('source') ?? '').trim() || null;
    const readBranch = String(fd.get('readBranch') ?? '').trim() || null;
    const writeBranch = String(fd.get('writeBranch') ?? '').trim() || null;
    const visibility = String(fd.get('visibility') ?? 'PRIVATE');

    if (!name) return fail(400, { error: 'Name is required' });

    try {
      await gqlClient(locals.token).request(CREATE_GRAPH_CONFIG_MUTATION, {
        orgId: params.id, name, source, readBranch, writeBranch, visibility,
      });
      redirect(303, `/app/orgs/${params.id}/graphs`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create graph' });
    }
  },
};
