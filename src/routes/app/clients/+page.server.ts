import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { MY_CLIENTS_QUERY } from '$lib/server/queries';
import type { Client } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token)
    .request<{ myClients: Client[] }>(MY_CLIENTS_QUERY)
    .catch(() => ({ myClients: [] as Client[] }));
  return { clients: data.myClients };
};
