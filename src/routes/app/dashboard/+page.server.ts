import { gqlClient } from '$lib/server/api';
import {
  MY_APPS_QUERY,
  MY_MEMORIES_QUERY,
} from '$lib/server/queries';
import type { App, Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  const apiClient = gqlClient(locals.token);
  const parentData = await parent();
  const [appsData, memoriesData] = await Promise.all([
    apiClient.request<{ myApps: App[] }>(MY_APPS_QUERY).catch(() => ({ myApps: [] as App[] })),
    apiClient.request<{ myMemories: Memory[] }>(MY_MEMORIES_QUERY).catch(() => ({ myMemories: [] as Memory[] })),
  ]);
  return {
    orgs: parentData.orgs,
    isConsumerMode: parentData.isConsumerMode,
    apps: appsData.myApps,
    memories: memoriesData.myMemories,
  };
};
