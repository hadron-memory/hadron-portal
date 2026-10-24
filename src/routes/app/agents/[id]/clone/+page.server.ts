/**
 * #1262 — clone an Agent into an organization the caller administers.
 *
 * Path: /app/agents/[id]/clone. The source is read through the same
 * owner-accessible `agent(ref:)` the detail page uses, so an unreadable source
 * is a plain 404. The target list is a hint (OWNER/ADMIN orgs from the layout's
 * membership list); the server's own ADMIN gate is authoritative on submit.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { AGENT_PUBLIC_QUERY, CLONE_AGENT_MUTATION } from '$lib/server/queries';
import { cloneRefusal, eligibleCloneTargets } from '$lib/agents/clone';
import type { Agent, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { cloneAgentSchema } from './schema';

const adapter = zod4(cloneAgentSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const client = gqlClient(locals.token);
  const [{ agent }, layout] = await Promise.all([
    client
      .request<{ agent: Pick<Agent, 'id' | 'urn' | 'name' | 'description' | 'organizationId' | 'visibility'> | null }>(AGENT_PUBLIC_QUERY, { ref: params.id })
      .catch(() => {
        throw error(500, 'Failed to load agent');
      }),
    parent() as Promise<{ user?: { id: string } | null; navOrgs?: Organization[] }>,
  ]);
  if (!agent) throw error(404, 'Agent not found or no longer available');
  const targets = eligibleCloneTargets(layout.navOrgs ?? [], layout.user?.id).map((o) => ({ id: o.id, urn: o.urn, name: o.name }));
  return {
    agent,
    targets,
    form: await superValidate({ target: targets.length === 1 ? targets[0].id : '', name: '', slug: '' }, adapter, { errors: false }),
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), adapter);
    if (!form.valid) return fail(400, { form });
    const { target, name, slug } = form.data;
    let newId: string;
    try {
      const res = await gqlClient(locals.token).request<{ cloneAgent: { id: string } }>(CLONE_AGENT_MUTATION, {
        source: params.id,
        target,
        ...(name ? { name } : {}),
        ...(slug ? { slug } : {}),
      });
      newId = res.cloneAgent.id;
    } catch (err) {
      const r = cloneRefusal(err);
      if (r.field) {
        form.errors = { ...form.errors, [r.field]: [r.text] };
      } else {
        form.message = { type: 'error', text: r.text };
      }
      form.valid = false;
      return fail(r.status, { form, blockers: r.blockers ?? [] });
    }
    redirect(303, `/app/agents/${encodeURIComponent(newId)}`);
  },
};
