import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const data = await gqlClient().request<{ memories: { items: Memory[] } }>(
      PUBLIC_MEMORIES_QUERY, { limit: 6 },
    );
    return { publicMemories: data.memories.items };
  } catch (e: unknown) {
    console.error('Failed to load public memories for home page', e);
    return { publicMemories: [] as Memory[] };
  }
};
