import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode, gqlErrorTextForBranching, extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_AGENT_MUTATION, ORG_CHROME_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createAgentSchema } from './schema';
import { limitMessage, limitRefusal } from '$lib/server/limit-refusal';

const createAgentFormAdapter = zod4(createAgentSchema);

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORG_CHROME_QUERY, { ref: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });
  if (!data.organization) throw error(404, 'Organization not found');
  // #320: the header command bar (Create mode) can deep-link here with the
  // agent slug prefilled (`?slug=<slug>`).
  const prefillSlug = (url.searchParams.get('slug') ?? '').trim();
  const form = await superValidate({ slug: prefillSlug }, createAgentFormAdapter, { errors: false });
  return { org: data.organization, prefillSlug, form };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), createAgentFormAdapter);
    if (!form.valid) return fail(400, { form });

    // #2647: the typed slug is sent as `slug` (the URN atom); `name` is the display name.
    const slug = form.data.slug;
    const name = form.data.displayName || slug;
    const description = form.data.description || null;

    const visibility = form.data.visibility;
    try {
      const result = await gqlClient(locals.token).request<{ createAgent: { id: string } }>(CREATE_AGENT_MUTATION, {
        orgRef: params.id, slug, name, description, visibility,
      });
      redirect(303, `/app/orgs/${params.id}/agents`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const limit = limitRefusal(e);
      if (limit) return message(form, limitMessage(limit), { status: limit.status });
      const msg = extractGqlError(e, 'Failed to create agent', ["AGENT_URN_TAKEN"]);
      if (extractGqlErrorCode(e) === 'AGENT_URN_TAKEN' || /agent with URN/i.test(gqlErrorTextForBranching(e, ['AGENT_URN_TAKEN']))) return setError(form, 'slug', msg, { status: 409 });
      return message(form, { type: 'error', text: msg }, { status: 500 });
    }
  },
};
