// #648 part 2: org-less (personal) app create/install. An individual installs a
// PUBLIC agent or their OWN personal agent as a user-owned App (createApp with no
// orgId, spec 047). Unlike the org install route (/app/orgs/[id]/agents/install/
// [aid]), the agent is chosen HERE (picker) — or pre-selected via ?agent=<id>
// from the org-less agent detail page — so there's no [aid] path param.
//
// This replaces the old 308→/app/orgs redirector (which dead-ended an individual
// user; #647 corrected its comment, #648 wires the real flow).
import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import {
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  MY_APPS_QUERY,
  CREATE_PERSONAL_APP_MUTATION,
} from '$lib/server/queries';
import { deriveDefaultUrn } from '$lib/install/derive-default-urn';
import { deriveDefaultName } from '$lib/install/derive-default-name';
import type { Actions, PageServerLoad } from './$types';
import { createPersonalAppSchema } from './schema';

type CreatePersonalAppForm = Infer<typeof createPersonalAppSchema, 'zod4'>;
const adapter = zod4(createPersonalAppSchema);

/** An agent the caller may install into a personal App (own personal ∪ PUBLIC). */
export interface InstallableAgent {
  id: string;
  urn: string;
  name: string;
  description: string | null;
}

/** Last ':'-segment of a canonical agent URN — the default app slug seed. */
function agentSlugFromUrn(urn: string): string {
  const colon = urn.lastIndexOf(':');
  return colon >= 0 ? urn.slice(colon + 1) : urn;
}

/**
 * The agents installable into a personal App: the caller's OWN (org-less)
 * personal agents ∪ every PUBLIC agent — mirroring the server install gate
 * (createApp: a personal App may install a PUBLIC or the caller's own personal
 * agent). Deduped by id (a public agent could also be the caller's own).
 */
async function fetchInstallableAgents(
  client: ReturnType<typeof gqlClient>,
): Promise<InstallableAgent[]> {
  const [mine, pub] = await Promise.all([
    fetchAllItems<InstallableAgent & { organizationId: string | null }>(client, MY_AGENTS_QUERY, 'agents')
      .then((list) => list.filter((a) => a.organizationId == null))
      .catch(() => [] as Array<InstallableAgent & { organizationId: string | null }>),
    fetchAllItems<InstallableAgent>(client, PUBLIC_AGENTS_QUERY, 'publicAgents')
      .catch(() => [] as InstallableAgent[]),
  ]);
  const seen = new Set<string>();
  return [...mine, ...pub]
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .map((a) => ({ id: a.id, urn: a.urn, name: a.name, description: a.description ?? null }));
}

export const load: PageServerLoad = async ({ locals, url, parent }) => {
  // The personal-App URN roots on the caller's bare handle (server namespaces it);
  // a handle-less account can't create one — surface that in the page.
  const { user } = await parent();
  const handle = (user as { handle?: string | null } | undefined)?.handle ?? null;

  const client = gqlClient(locals.token);
  const [agents, ownApps] = await Promise.all([
    fetchInstallableAgents(client),
    fetchAllItems<{ urn: string; name: string; organizationId: string | null }>(client, MY_APPS_QUERY, 'apps')
      .then((list) => list.filter((a) => a.organizationId == null))
      .catch(() => [] as Array<{ urn: string; name: string; organizationId: string | null }>),
  ]);

  // Pre-select ?agent=<id> when it's installable (deep-link from the agent detail
  // "Install as app"); otherwise the first installable agent.
  const requested = url.searchParams.get('agent');
  const selected = agents.find((a) => a.id === requested) ?? agents[0] ?? null;

  const existingUrns = ownApps.map((a) => a.urn);
  const existingNames = ownApps.map((a) => a.name);
  const namespace = handle ?? '';
  const slug = selected ? agentSlugFromUrn(selected.urn) : '';
  const defaultUrn = selected && namespace ? deriveDefaultUrn(namespace, slug, existingUrns) : '';
  const defaultUrnSlug =
    namespace && defaultUrn.startsWith(namespace + ':') ? defaultUrn.slice(namespace.length + 1) : defaultUrn;
  const defaultName = selected ? deriveDefaultName(selected.name, existingNames) : '';

  return {
    agents,
    handle,
    form: await superValidate<CreatePersonalAppForm>(
      { agentId: selected?.id ?? '', name: defaultName, urn: defaultUrnSlug, appType: 'WORKSTATION' },
      adapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate<CreatePersonalAppForm>(await request.formData(), adapter);
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    // Re-check installability on POST — load()'s gate doesn't run on submit, and
    // a crafted POST could name a foreign private agent (the server rejects it
    // too, but this gives a friendly field error instead of a raw GraphQL one).
    const installable = await fetchInstallableAgents(client);
    if (!installable.some((a) => a.id === form.data.agentId)) {
      return setError(form, 'agentId', 'That agent can’t be installed as a personal app.', { status: 400 });
    }

    // Surfaces derive from appType so the App manage page shows the right tabs
    // (CHATBOT → chat; else mcp) — same rule as the org install action.
    const { agentId, name, urn, appType } = form.data;
    const surfaces = appType === 'CHATBOT' ? ['chat'] : ['mcp'];

    let createdId: string;
    try {
      const res = await client.request<{ createApp: { id: string } }>(CREATE_PERSONAL_APP_MUTATION, {
        agentId,
        name,
        urn,
        appType,
        surfaces,
      });
      createdId = res.createApp.id;
    } catch (e) {
      const msg = extractGqlError(e, 'Failed to create app.');
      if (/already exists/i.test(msg)) {
        return setError(form, 'urn', 'An app with that URN already exists.', { status: 409 });
      }
      // Handle-less account / agent-not-found / other → surface as a form error.
      return message(form, { type: 'error', text: msg }, { status: 400 });
    }

    redirect(303, `/app/apps/${createdId}`);
  },
};
