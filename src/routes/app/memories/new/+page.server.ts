import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { gqlErrorTextForBranching, extractGqlError } from '$lib/server/gqlError';
import { CREATE_PERSONAL_MEMORY_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { createPersonalMemorySchema } from './schema';

const adapter = zod4(createPersonalMemorySchema);

export const load: PageServerLoad = async ({ url }) => {
  // #627: org-less personal-memory create — available to any signed-in user
  // (the /app layout already guards auth). No requireNonConsumer here: this is
  // exactly the individual-user path that requireNonConsumer bounces.
  const prefillSlug = (url.searchParams.get('slug') ?? '').trim();
  const form = await superValidate({ slug: prefillSlug }, adapter, { errors: false });
  return { form, prefillSlug };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), adapter);
    if (!form.valid) return fail(400, { form });

    const { slug, displayName, description, memoryClass } = form.data;
    // #2647: the typed slug is the URN atom, sent as `slug`; `name` is the display name.
    const name = displayName || slug;
    const tags: string[] = [];

    try {
      // No orgId → user-owned tenancy (spec 047): the memory roots on the
      // caller's handle namespace as class personal/private.
      const result = await gqlClient(locals.token).request<{ createMemory: { id: string } }>(
        CREATE_PERSONAL_MEMORY_MUTATION,
        { slug, name, description: description || null, tags, memoryClass },
      );
      redirect(303, `/app/memories/${result.createMemory.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const error = extractGqlError(e, 'Failed to create memory');
      if (/memory with URN/i.test(gqlErrorTextForBranching(e))) {
        return setError(form, 'slug', error, { status: 409 });
      }
      return message(form, { type: 'error', text: error }, { status: 500 });
    }
  },
};
