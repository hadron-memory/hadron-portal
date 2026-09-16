import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORG_APP_INSTALLS_QUERY,
  ORG_AGENT_GRANTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  CREATE_AGENT_ORG_GRANT_MUTATION,
  REVOKE_AGENT_ORG_GRANT_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { orgAgentSubscribeSchema, orgAgentUnsubscribeSchema } from './schema';

type OrgAgentSubscribeForm = Infer<typeof orgAgentSubscribeSchema, 'zod4'>;
type OrgAgentUnsubscribeForm = Infer<typeof orgAgentUnsubscribeSchema, 'zod4'>;

const orgAgentSubscribeFormAdapter = zod4(orgAgentSubscribeSchema);
const orgAgentUnsubscribeFormAdapter = zod4(orgAgentUnsubscribeSchema);

type AppInstall = { id: string; name: string; agentId: string | null };

/** One publicAgents item as the subscribe picker consumes it (#486). */
export interface PublicAgent {
  id: string;
  urn: string;
  name: string;
  description: string | null;
  organizationId: string;
  visibility: string;
}

/** One AgentOrgGrant row as the Subscribed tab consumes it (#486). */
export interface AgentGrant {
  agentId: string;
  activatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
  createdAt: string;
  agent: {
    id: string;
    urn: string;
    name: string;
    description: string | null;
    organizationId: string;
  } | null;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  // #382: the org comes from the LAYOUT, which has already run
  // ORGANIZATION_QUERY for this same `params.id` on this same request. Fetching
  // it again here was a second identical round trip per page load. The layout
  // also raises the missing-org 404 and lets transient errors propagate as 500,
  // which is the same split the removed comment described.
  const { org } = await parent();
  const [apps, grantsData, publicAgents] = await Promise.all([
    // Which agents are already installed as an App → { agentId: { appId, appName } }.
    // Non-fatal: on failure the "Open" affordance simply doesn't render.
    fetchAllItems<AppInstall>(client, ORG_APP_INSTALLS_QUERY, 'apps', { orgId: params.id }).catch(
      () => [] as AppInstall[],
    ),
    // Subscribed tab (#486): the org's AgentOrgGrants. The server resolver
    // returns [] for non-admins (no error), so a thrown error here is a real
    // transport failure — coerce to null so the tab shows "unavailable"
    // rather than a false "no subscriptions" (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    client
      .request<{ organization: { agentOrgGrants: AgentGrant[] } | null }>(
        ORG_AGENT_GRANTS_QUERY, { ref: params.id },
      )
      .then((r) => r.organization?.agentOrgGrants ?? [])
      .catch((e) => {
        console.warn(`[org-agents] grants fetch failed for ${params.id}:`, e);
        return null;
      }),
    // Subscribe picker (#486 / hadron-server#551): the cross-org PUBLIC
    // marketplace slice. Best-effort — a failure just leaves the picker
    // empty; the Subscribed table above it is unaffected.
    fetchAllItems<PublicAgent>(client, PUBLIC_AGENTS_QUERY, 'publicAgents').catch((e) => {
      console.warn('[org-agents] publicAgents fetch failed:', e);
      return [] as PublicAgent[];
    }),
  ]);


  // First install wins if an agent is installed in more than one app.
  const installedByAgent: Record<string, { appId: string; appName: string }> = {};
  for (const app of apps) {
    if (app.agentId && !installedByAgent[app.agentId]) {
      installedByAgent[app.agentId] = { appId: app.id, appName: app.name };
    }
  }

  // "Subscribed" = grants for agents OWNED BY OTHER ORGS (#486). Grants for
  // the org's own agents (auto-provisioned by every install) are noise here.
  const subscribedGrants =
    grantsData === null
      ? null
      : grantsData.filter((g) => g.agent && g.agent.organizationId !== params.id);

  // Picker candidates: public agents the org doesn't own and isn't already
  // subscribed to (any grant row counts — active or not; re-subscribing a
  // revoked grant is an admin conversation, not a picker click).
  const grantedAgentIds = new Set((grantsData ?? []).map((g) => g.agentId));
  const subscribablePublicAgents = publicAgents.filter(
    (a) => a.organizationId !== params.id && !grantedAgentIds.has(a.id),
  );

  const [subscribeForm, unsubscribeForm] = await Promise.all([
    superValidate<OrgAgentSubscribeForm>(
      { agentId: '' },
      orgAgentSubscribeFormAdapter,
      { errors: false },
    ),
    superValidate<OrgAgentUnsubscribeForm>(
      { agentId: '' },
      orgAgentUnsubscribeFormAdapter,
      { errors: false },
    ),
  ]);

  return {
    org,
    installedByAgent,
    subscribedGrants,
    subscribablePublicAgents,
    subscribeForm,
    unsubscribeForm,
  };
};

export const actions: Actions = {
  subscribe: async ({ request, params, locals }) => {
    const form = await superValidate<OrgAgentSubscribeForm>(
      await request.formData(),
      orgAgentSubscribeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CREATE_AGENT_ORG_GRANT_MUTATION, {
        agentRef: form.data.agentId,
        orgRef: params.id,
      });
      return message(form, {
        type: 'success',
        text: t('org-agents.subscribed.added', 'Subscribed to agent.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: extractGqlError(
            e,
            t('org-agents.subscribed.error', 'Failed to subscribe to the agent.'),
          ),
        },
        { status: 500 },
      );
    }
  },
  unsubscribe: async ({ request, params, locals }) => {
    const form = await superValidate<OrgAgentUnsubscribeForm>(
      await request.formData(),
      orgAgentUnsubscribeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REVOKE_AGENT_ORG_GRANT_MUTATION, {
        agentRef: form.data.agentId,
        orgRef: params.id,
      });
      return message(form, {
        type: 'success',
        text: t('org-agents.subscribed.unsubscribe.success', 'Unsubscribed from agent.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: extractGqlError(
            e,
            t(
              'org-agents.subscribed.unsubscribe.error',
              'Failed to remove the agent subscription.',
            ),
          ),
        },
        { status: 500 },
      );
    }
  },
};
