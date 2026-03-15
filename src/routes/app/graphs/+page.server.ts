import { gqlClient } from '$lib/server/api';
import { MY_GRAPHS_QUERY } from '$lib/server/queries';
import type { Graph } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const apiClient = gqlClient(locals.token);
  const data = await apiClient
    .request<{ myGraphs: Graph[] }>(MY_GRAPHS_QUERY)
    .catch(() => ({ myGraphs: [] as Graph[] }));
  return { graphs: data.myGraphs };
};
