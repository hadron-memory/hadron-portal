import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY, ADD_TO_MY_MEMORIES_MUTATION } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  try {
    const data = await gqlClient().request<{ publicMemories: Memory[] }>(PUBLIC_MEMORIES_QUERY);
    return { memories: data.publicMemories };
  } catch {
    return { memories: [] as Memory[] };
  }
};

export const actions: Actions = {
  addToMyMemories: async ({ request, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');

    if (!locals.token) {
      redirect(303, `/signup?memory=${memoryId}`);
    }

    try {
      await gqlClient(locals.token).request(ADD_TO_MY_MEMORIES_MUTATION, { memoryId });
      redirect(303, '/app/dashboard');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add memory' });
    }
  },
};
