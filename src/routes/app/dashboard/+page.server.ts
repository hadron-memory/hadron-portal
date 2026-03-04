import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, MY_CLIENTS_QUERY } from '$lib/server/queries';
import type { Organization, Client } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const apiClient = gqlClient(locals.token);
  const [orgsData, clientsData] = await Promise.all([
    apiClient.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY).catch(() => ({ myOrganizations: [] as Organization[] })),
    apiClient.request<{ clients: Client[] }>(MY_CLIENTS_QUERY).catch(() => ({ clients: [] as Client[] })),
  ]);
  return {
    orgs: orgsData.myOrganizations,
    clients: clientsData.clients,
  };
};
