import { gqlClient } from '$lib/server/api';
import { PUBLIC_GRAPHS_QUERY } from '$lib/server/queries';
import type { Graph } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const data = await gqlClient().request<{ publicGraphs: Graph[] }>(PUBLIC_GRAPHS_QUERY);
    return { publicGraphs: data.publicGraphs.slice(0, 6) };
  } catch {
    return { publicGraphs: [] as Graph[] };
  }
};
