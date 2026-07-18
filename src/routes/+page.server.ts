import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY, JOIN_WAITING_LIST_MUTATION } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { waitingListSchema } from './schema';

const waitingListFormAdapter = zod4(waitingListSchema);
type WaitingListForm = Infer<typeof waitingListSchema, 'zod4'>;

export const load: PageServerLoad = async () => {
  try {
    const data = await gqlClient().request<{ memories: { items: Memory[] } }>(
      PUBLIC_MEMORIES_QUERY, { limit: 6 },
    );
    return {
      publicMemories: data.memories.items,
      waitingListForm: await superValidate<WaitingListForm>({}, waitingListFormAdapter, { errors: false }),
    };
  } catch {
    return {
      publicMemories: [] as Memory[],
      waitingListForm: await superValidate<WaitingListForm>({}, waitingListFormAdapter, { errors: false }),
    };
  }
};

export const actions: Actions = {
  waitingList: async ({ request }) => {
    const form = await superValidate<WaitingListForm>(await request.formData(), waitingListFormAdapter);
    if (!form.valid) return fail(400, { form });

    const requestedFeatures = form.data.requestedFeatures || null;
    try {
      await gqlClient().request(JOIN_WAITING_LIST_MUTATION, { email: form.data.email, requestedFeatures });
      return message(form, { type: 'success', text: "You're on the list! We'll be in touch." });
    } catch {
      return message(form, { type: 'error', text: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  },
};
