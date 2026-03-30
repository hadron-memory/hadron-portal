import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY, JOIN_WAITING_LIST_MUTATION, SEND_CONTACT_MESSAGE_MUTATION } from '$lib/server/queries';
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

  contact: async ({ request }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const message = String(fd.get('message') ?? '').trim();
    if (!name || !email || !message) return fail(400, { contactError: 'All fields are required' });
    try {
      await gqlClient().request(SEND_CONTACT_MESSAGE_MUTATION, { name, email, message });
      return { contactSuccess: true };
    } catch {
      return fail(500, { contactError: 'Failed to send message. Please try again.' });
    }
  },
};
