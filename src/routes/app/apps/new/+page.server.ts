// #648 part 2: org-less (personal) app create/install. An individual installs a
// PUBLIC agent, their OWN personal agent, or (#1786, hadron-server#3626) an
// ORGANIZATION-visible agent of an organization they belong to, as a user-owned
// App (createApp with no orgId, spec 047). Unlike the org install route (/app/orgs/[id]/agents/install/
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
import { classifyGqlError, extractGqlErrorCode, gqlErrorTextForBranching, extractGqlError } from '$lib/server/gqlError';
import { CREATE_APP_REFUSALS } from '$lib/server/create-app-refusals';
import {
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  MY_APPS_QUERY,
  CREATE_PERSONAL_APP_MUTATION,
} from '$lib/server/queries';
import { fetchOrgVisibleAgents } from '$lib/server/installable-agents';
import { deriveDefaultUrn } from '$lib/install/derive-default-urn';
import { deriveDefaultName } from '$lib/install/derive-default-name';
import type { Actions, PageServerLoad } from './$types';
import { createPersonalAppSchema } from './schema';
import { limitMessage, limitRefusal } from '$lib/server/limit-refusal';

type CreatePersonalAppForm = Infer<typeof createPersonalAppSchema, 'zod4'>;
const adapter = zod4(createPersonalAppSchema);

/** An agent the caller may install into a personal App (own personal ∪ PUBLIC ∪ member-org ORGANIZATION). */
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
 * personal agents ∪ every PUBLIC agent ∪ (#1786) the ORGANIZATION-visible
 * agents of each organization the caller belongs to — the set the server's
 * install gate admits (hadron-server#3626, `requirePersonalAppAgentInstall`).
 * The list only suggests: createApp rechecks, and refuses an ex-member.
 * Deduped by id, first source wins, in the order mine, public, organization.
 *
 * `ok` is false when ANY lookup failed — the list is then unreliable and
 * callers must NOT treat it as authoritative: a transient failure would
 * otherwise (a) show "no agents" on GET and (b) reject a valid own/public agent
 * on POST. On failure the loader surfaces an error and the action defers to the
 * server's createApp gate instead of pre-rejecting.
 */
async function fetchInstallableAgents(
  client: ReturnType<typeof gqlClient>,
): Promise<{ agents: InstallableAgent[]; ok: boolean }> {
  let ok = true;
  const [mine, pub, org] = await Promise.all([
    // #782: server-side filter.ownedByMe — already the caller's own org-less agents.
    fetchAllItems<InstallableAgent>(client, MY_AGENTS_QUERY, 'agents')
      .catch(() => {
        ok = false;
        return [] as InstallableAgent[];
      }),
    fetchAllItems<InstallableAgent>(client, PUBLIC_AGENTS_QUERY, 'publicAgents')
      .catch(() => {
        ok = false;
        return [] as InstallableAgent[];
      }),
    fetchOrgVisibleAgents<InstallableAgent>(client)
      .catch(() => {
        ok = false;
        return [] as InstallableAgent[];
      }),
  ]);
  const seen = new Set<string>();
  const agents = [...mine, ...pub, ...org]
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .map((a) => ({ id: a.id, urn: a.urn, name: a.name, description: a.description ?? null }));
  return { agents, ok };
}

export const load: PageServerLoad = async ({ locals, url, parent }) => {
  // The personal-App URN roots on the caller's bare handle (server namespaces it);
  // a handle-less account can't create one — surface that in the page.
  const { user } = await parent();
  const handle = (user as { handle?: string | null } | undefined)?.handle ?? null;

  const client = gqlClient(locals.token);
  const [installable, ownApps] = await Promise.all([
    fetchInstallableAgents(client),
    // #782: server-side filter.ownedByMe — already the caller's own org-less apps.
    fetchAllItems<{ urn: string; name: string }>(client, MY_APPS_QUERY, 'apps')
      .catch(() => [] as Array<{ urn: string; name: string }>),
  ]);
  const agents = installable.agents;

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
    // Distinguish a lookup failure from a genuinely empty installable set — the
    // page shows "couldn't load" rather than "no agents to install".
    loadFailed: !installable.ok,
    handle,
    // The caller's own app URNs, so the client can reseed a COLLISION-FREE URN
    // default when the picked agent changes (same suffixing the loader used).
    existingAppUrns: existingUrns,
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
    // a crafted POST could name a foreign private agent, or an ex-member could
    // name an organization agent they no longer qualify for (#1786); this gives
    // a friendly field error instead of a raw GraphQL one. But only REJECT when the lookup
    // is reliable (ok): a transient fetch failure must not reject a valid agent —
    // defer to the server's createApp gate, which is authoritative either way.
    const installable = await fetchInstallableAgents(client);
    if (installable.ok && !installable.agents.some((a) => a.id === form.data.agentId)) {
      return setError(form, 'agentId', 'That agent can’t be installed as a personal app.', { status: 400 });
    }

    // Surfaces derive from appType so the App manage page shows the right tabs
    // (CHATBOT → chat; else mcp) — same rule as the org install action.
    const { agentId, name, urn, appType } = form.data;
    const surfaces = appType === 'CHATBOT' ? ['chat'] : ['mcp'];

    let createdId: string;
    try {
      const res = await client.request<{ createApp: { id: string } }>(CREATE_PERSONAL_APP_MUTATION, {
        agentRef: agentId,
        name,
        urn,
        appType,
        surfaces,
      });
      createdId = res.createApp.id;
    } catch (e) {
      const limit = limitRefusal(e);
      if (limit) return message(form, limitMessage(limit), { status: limit.status });
      const msg = extractGqlError(e, 'Failed to create app.', CREATE_APP_REFUSALS);
      if (/already exists/i.test(gqlErrorTextForBranching(e))) {
        return setError(form, 'urn', 'An app with that URN already exists.', { status: 409 });
      }
      // Handle-less account / agent-not-found / other → surface as a form error.
      return message(form, { type: 'error', text: msg }, { status: classifyGqlError(e).kind === 'transport' || (CREATE_APP_REFUSALS as readonly string[]).includes(extractGqlErrorCode(e) ?? '') ? 400 : 500 });
    }

    redirect(303, `/app/apps/${createdId}`);
  },
};
