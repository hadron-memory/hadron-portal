import { gqlClient } from '$lib/server/api';
import {
  MY_STATIONS_QUERY,
  MY_MEMORIES_QUERY,
} from '$lib/server/queries';
import type { Station, Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  const apiClient = gqlClient(locals.token);
  const parentData = await parent();
  const [stationsData, memoriesData] = await Promise.all([
    apiClient.request<{ myStations: Station[] }>(MY_STATIONS_QUERY).catch(() => ({ myStations: [] as Station[] })),
    apiClient.request<{ myMemories: Memory[] }>(MY_MEMORIES_QUERY).catch(() => ({ myMemories: [] as Memory[] })),
  ]);
  return {
    orgs: parentData.orgs,
    isConsumerMode: parentData.isConsumerMode,
    stations: stationsData.myStations,
    memories: memoriesData.myMemories,
  };
};
