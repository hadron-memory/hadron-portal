import { gqlClient } from '$lib/server/api';
import {
  MY_CLIENTS_QUERY,
  MY_GRAPHS_QUERY,
} from '$lib/server/queries';
import type { Client, Graph } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  const apiClient = gqlClient(locals.token);
  const parentData = await parent();
  const [clientsData, graphsData] = await Promise.all([
    apiClient.request<{ myClients: Client[] }>(MY_CLIENTS_QUERY).catch(() => ({ myClients: [] as Client[] })),
    apiClient.request<{ myGraphs: Graph[] }>(MY_GRAPHS_QUERY).catch(() => ({ myGraphs: [] as Graph[] })),
  ]);
  return {
    orgs: parentData.orgs,
    hasExplicitOrg: parentData.hasExplicitOrg,
    clients: clientsData.myClients,
    graphs: graphsData.myGraphs,
  };
};
