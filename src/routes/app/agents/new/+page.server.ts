import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode, gqlErrorTextForBranching, extractGqlError } from '$lib/server/gqlError';
import { CREATE_PERSONAL_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { createPersonalAgentSchema } from './schema';

const adapter = zod4(createPersonalAgentSchema);

export const load: PageServerLoad = async ({ url }) => {
  // #636: org-less agent create — available to any signed-in user (the /app
  // layout already guards auth). No requireNonConsumer: this is exactly the
  // individual-user path that requireNonConsumer bounces. The command bar can
  // deep-link with the slug prefilled (?slug=<slug>).
  const prefillSlug = (url.searchParams.get('slug') ?? '').trim();
  const form = await superValidate({ slug: prefillSlug }, adapter, { errors: false });
  return { form, prefillSlug };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), adapter);
    if (!form.valid) return fail(400, { form });

    const { slug, displayName, description } = form.data;
    const name = slug; // the slug is the URN atom; createAgent mints from it

    try {
      // No orgId → user-owned tenancy: the agent roots on the caller's handle
      // namespace with visibility PERSONAL.
      const result = await gqlClient(locals.token).request<{ createAgent: { id: string } }>(
        CREATE_PERSONAL_AGENT_MUTATION,
        { name, description: description || null, visibility: 'PERSONAL' },
      );
      // Seed a friendly display name when it differs from the slug (best-effort,
      // mirrors the org create flow).
      if (displayName && displayName !== name) {
        await gqlClient(locals.token)
          .request(UPDATE_AGENT_MUTATION, { ref: result.createAgent.id, name: displayName })
          .catch(() => {});
      }
      redirect(303, `/app/agents/${result.createAgent.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const error = extractGqlError(e, 'Failed to create agent', ["AGENT_URN_TAKEN"]);
      if (extractGqlErrorCode(e) === 'AGENT_URN_TAKEN' || /agent with URN/i.test(gqlErrorTextForBranching(e, ['AGENT_URN_TAKEN']))) {
        return setError(form, 'slug', error, { status: 409 });
      }
      return message(form, { type: 'error', text: error }, { status: 500 });
    }
  },
};
