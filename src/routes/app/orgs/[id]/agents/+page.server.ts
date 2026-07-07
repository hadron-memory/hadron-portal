import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, ORG_APP_INSTALLS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

type AppInstall = { id: string; name: string; agentId: string | null };

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [data, apps] = await Promise.all([
    // Let transient GraphQL/network errors propagate (→ 500); a genuinely
    // missing org is handled by the `!data.organization` 404 below. (Coercing
    // every error to 404 here would hide real failures — the spec-018 lesson.)
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id }),
    // Which agents are already installed as an App → { agentId: { appId, appName } }.
    // Non-fatal: on failure the "Open" affordance simply doesn't render.
    fetchAllItems<AppInstall>(client, ORG_APP_INSTALLS_QUERY, 'apps', { orgId: params.id }).catch(
      () => [] as AppInstall[],
    ),
  ]);

  if (!data.organization) throw error(404, 'Organization not found');

  // First install wins if an agent is installed in more than one app.
  const installedByAgent: Record<string, { appId: string; appName: string }> = {};
  for (const app of apps) {
    if (app.agentId && !installedByAgent[app.agentId]) {
      installedByAgent[app.agentId] = { appId: app.id, appName: app.name };
    }
  }

  return { org: data.organization, installedByAgent };
};
