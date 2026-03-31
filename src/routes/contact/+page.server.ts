import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { SEND_CONTACT_MESSAGE_MUTATION } from '$lib/server/queries';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const message = String(fd.get('message') ?? '').trim();
    if (!name || !email || !message) return fail(400, { error: 'All fields are required' });
    try {
      await gqlClient().request(SEND_CONTACT_MESSAGE_MUTATION, { name, email, message });
      return { success: true };
    } catch {
      return fail(500, { error: 'Failed to send message. Please try again.' });
    }
  },
};
