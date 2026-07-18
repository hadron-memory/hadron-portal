import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, CREATE_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createAgentSchema } from './schema';

const createAgentFormAdapter = zod4(createAgentSchema);

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY, { id: params.id },
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

    const name = form.data.slug;
    const displayName = form.data.displayName;
    const description = form.data.description || null;
    const systemPrompt = form.data.systemPrompt || null;
    const visibility = form.data.visibility;
    try {
      const result = await gqlClient(locals.token).request<{ createAgent: { id: string } }>(CREATE_AGENT_MUTATION, {
        orgId: params.id, name, description, systemPrompt, visibility,
      });
      if (displayName && displayName !== name) {
        await gqlClient(locals.token).request(UPDATE_AGENT_MUTATION, {
          id: result.createAgent.id, name: displayName,
        }).catch(() => {});
      }
      redirect(303, `/app/orgs/${params.id}/agents`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const msg = extractGqlError(e, 'Failed to create agent');
      if (/agent with URN/i.test(msg)) return setError(form, 'slug', msg, { status: 409 });
      return message(form, msg, { status: 500 });
    }
  },
};
