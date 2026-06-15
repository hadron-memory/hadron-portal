import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, AI_SERVICE_CONFIGS_QUERY } from '$lib/server/queries';
import type { Organization, AiServiceConfig } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [orgData, configsData] = await Promise.all([
    client.request<{ organization: Organization }>(ORGANIZATION_QUERY, { id: params.id }),
    // The registry list is org-ADMIN gated server-side; non-admin members get a
    // GraphQL error here — surface it as an empty/error state, not a 500.
    client
      .request<{ aiServiceConfigs: AiServiceConfig[] }>(AI_SERVICE_CONFIGS_QUERY, {
        ownerType: 'ORGANIZATION',
        ownerId: params.id,
      })
      .catch(() => null),
  ]);
  return {
    org: orgData.organization,
    configs: configsData?.aiServiceConfigs ?? [],
    configsError: configsData === null,
    currentUserId: locals.user?.id ?? null,
  };
};
