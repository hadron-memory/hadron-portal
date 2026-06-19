import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, CREATE_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY, { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });
  if (!data.organization) throw error(404, 'Organization not found');
  // #320: the header command bar (Create mode) can deep-link here with the
  // agent slug prefilled (`?slug=<slug>`).
  return { org: data.organization, prefillSlug: (url.searchParams.get('slug') ?? '').trim() };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const slug = String(fd.get('slug') ?? '').trim();
    const displayName = String(fd.get('displayName') ?? '').trim();
    const name = slug || displayName;
    const description = String(fd.get('description') ?? '').trim() || null;
    const systemPrompt = String(fd.get('systemPrompt') ?? '').trim() || null;
    const visibility = String(fd.get('visibility') ?? '').trim() || undefined;
    if (!name) return fail(400, { error: 'Name is required' });
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
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create agent' });
    }
  },
};
