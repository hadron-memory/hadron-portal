import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, MY_EXCHANGE_CONNECTIONS_QUERY } from '$lib/server/queries';
import type { Organization, ExchangeConnection } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const [orgsData, exchangeData] = await Promise.all([
    gqlClient(locals.token)
      .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
    gqlClient(locals.token)
      .request<{ myExchangeConnections: ExchangeConnection[] }>(MY_EXCHANGE_CONNECTIONS_QUERY)
      .catch(() => ({ myExchangeConnections: [] as ExchangeConnection[] })),
  ]);
  return {
    orgs: orgsData.myOrganizations,
    exchangeConnections: exchangeData.myExchangeConnections,
  };
};
