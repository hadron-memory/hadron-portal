import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { MY_STATIONS_QUERY } from '$lib/server/queries';
import type { Station } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token)
    .request<{ myStations: Station[] }>(MY_STATIONS_QUERY)
    .catch(() => ({ myStations: [] as Station[] }));
  return { stations: data.myStations };
};
