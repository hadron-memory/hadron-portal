import { gqlClient } from '$lib/server/api';
import { MY_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const apiClient = gqlClient(locals.token);
  const data = await apiClient
    .request<{ myMemories: Memory[] }>(MY_MEMORIES_QUERY)
    .catch(() => ({ myMemories: [] as Memory[] }));
  return { memories: data.myMemories };
};
