import { gqlClient } from '$lib/server/api';
import { MY_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  // Agent system memories are hidden by default. A `system=1` URL param
  // toggles them on; the Svelte page renders a checkbox that navigates
  // with that query string.
  const includeAgentSystem = url.searchParams.get('system') === '1';
  const apiClient = gqlClient(locals.token);
  const data = await apiClient
    .request<{ myMemories: Memory[] }>(MY_MEMORIES_QUERY, { includeAgentSystem })
    .catch(() => ({ myMemories: [] as Memory[] }));
  return { memories: data.myMemories, includeAgentSystem };
};
