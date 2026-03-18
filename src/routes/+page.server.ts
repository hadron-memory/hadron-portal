import { gqlClient } from '$lib/server/api';
import { PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const data = await gqlClient().request<{ publicMemories: Memory[] }>(PUBLIC_MEMORIES_QUERY);
    return { publicMemories: data.publicMemories.slice(0, 6) };
  } catch {
    return { publicMemories: [] as Memory[] };
  }
};
