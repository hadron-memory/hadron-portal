import { gqlClient } from '$lib/server/api';
import {
  MY_CLIENTS_QUERY,
  MY_MEMORIES_QUERY,
} from '$lib/server/queries';
import type { Client, Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  const apiClient = gqlClient(locals.token);
  const parentData = await parent();
  const [clientsData, memoriesData] = await Promise.all([
    apiClient.request<{ myClients: Client[] }>(MY_CLIENTS_QUERY).catch(() => ({ myClients: [] as Client[] })),
    apiClient.request<{ myMemories: Memory[] }>(MY_MEMORIES_QUERY).catch(() => ({ myMemories: [] as Memory[] })),
  ]);
  return {
    orgs: parentData.orgs,
    isConsumerMode: parentData.isConsumerMode,
    clients: clientsData.myClients,
    memories: memoriesData.myMemories,
  };
};
