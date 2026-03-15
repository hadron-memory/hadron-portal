import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_GRAPHS_QUERY, ADD_TO_MY_GRAPHS_MUTATION } from '$lib/server/queries';
import type { Graph } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  // Handle addGraph param (returning from sign-up with intent)
  const addGraphId = url.searchParams.get('addGraph');
  if (addGraphId && locals.token) {
    try {
      await gqlClient(locals.token).request(ADD_TO_MY_GRAPHS_MUTATION, { graphId: addGraphId });
      redirect(303, '/app/setup');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e;
      // Fall through to show browse page if add fails
    }
  }

  try {
    const data = await gqlClient().request<{ publicGraphs: Graph[] }>(PUBLIC_GRAPHS_QUERY);
    return { graphs: data.publicGraphs, isAuthenticated: !!locals.user };
  } catch {
    return { graphs: [] as Graph[], isAuthenticated: !!locals.user };
  }
};

export const actions: Actions = {
  addToMyGraphs: async ({ request, locals }) => {
    const fd = await request.formData();
    const graphId = String(fd.get('graphId') ?? '');

    if (!locals.token) {
      redirect(303, `/signup?graph=${graphId}`);
    }

    try {
      await gqlClient(locals.token).request(ADD_TO_MY_GRAPHS_MUTATION, { graphId });
      redirect(303, '/app/setup');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add graph' });
    }
  },
};
