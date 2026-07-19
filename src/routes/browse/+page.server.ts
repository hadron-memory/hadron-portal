import { fail, isRedirect, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { PUBLIC_MEMORIES_QUERY, ADD_TO_MY_MEMORIES_MUTATION } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { addPublicMemorySchema } from './schema';

const addPublicMemoryFormAdapter = zod4(addPublicMemorySchema);
type AddPublicMemoryForm = Infer<typeof addPublicMemorySchema, 'zod4'>;

export const load: PageServerLoad = async ({ locals, url }) => {
  const form = await superValidate<AddPublicMemoryForm>(
    { memoryId: '' },
    addPublicMemoryFormAdapter,
    { errors: false },
  );

  // Handle addMemory param (returning from sign-up with intent)
  const addMemoryId = url.searchParams.get('addGraph') ?? url.searchParams.get('addMemory');
  if (addMemoryId && locals.token) {
    try {
      await gqlClient(locals.token).request(ADD_TO_MY_MEMORIES_MUTATION, { memoryId: addMemoryId });
      redirect(303, '/app/dashboard');
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      // Fall through to show browse page if add fails
    }
  }

  try {
    const memories = await fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories');
    return {
      memories,
      isAuthenticated: !!locals.user,
      form,
    };
  } catch {
    return {
      memories: [] as Memory[],
      isAuthenticated: !!locals.user,
      form,
    };
  }
};

export const actions: Actions = {
  addToMyMemories: async ({ request, locals }) => {
    const form = await superValidate<AddPublicMemoryForm>(
      await request.formData(),
      addPublicMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    if (!locals.token) {
      redirect(303, `/signup?memory=${encodeURIComponent(form.data.memoryId)}`);
    }

    try {
      await gqlClient(locals.token).request(ADD_TO_MY_MEMORIES_MUTATION, {
        memoryId: form.data.memoryId,
      });
      redirect(303, '/app/dashboard');
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return message(
        form,
        { type: 'error', text: e instanceof Error ? e.message : 'Failed to add memory' },
        { status: 500 },
      );
    }
  },
};
