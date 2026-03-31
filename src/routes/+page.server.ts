import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY, JOIN_WAITING_LIST_MUTATION } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const data = await gqlClient().request<{ publicMemories: Memory[] }>(PUBLIC_MEMORIES_QUERY);
    return { publicMemories: data.publicMemories.slice(0, 6) };
  } catch {
    return { publicMemories: [] as Memory[] };
  }
};

export const actions: Actions = {
  waitingList: async ({ request }) => {
    const fd = await request.formData();
    const email = String(fd.get('email') ?? '').trim();
    const requestedFeatures = String(fd.get('requestedFeatures') ?? '').trim() || null;
    if (!email) return fail(400, { waitingListError: 'Email is required' });
    try {
      await gqlClient().request(JOIN_WAITING_LIST_MUTATION, { email, requestedFeatures });
      return { waitingListSuccess: true };
    } catch {
      return fail(500, { waitingListError: 'Something went wrong. Please try again.' });
    }
  },
};
