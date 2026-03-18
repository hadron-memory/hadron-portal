import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_QUERY, DELETE_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const loc = decodeURIComponent(params.loc);
  const data = await gqlClient(locals.token).request<{ node: MemoryNode | null }>(
    NODE_QUERY, { loc },
  );
  if (!data.node) throw new Error(`Node not found: ${loc}`);

  // Build breadcrumb from loc segments
  const parts = loc.split('.');
  const breadcrumb = parts.map((part, i) => ({
    label: part,
    path: parts.slice(0, i + 1).join('.'),
  }));

  return { node: data.node, breadcrumb };
};

export const actions: Actions = {
  delete: async ({ params, locals }) => {
    const loc = decodeURIComponent(params.loc);
    try {
      await gqlClient(locals.token).request(DELETE_NODE_MUTATION, { loc });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete' });
    }
    redirect(303, `/app/orgs/${params.id}/graphs/${params.gid}/nodes`);
  },
};
