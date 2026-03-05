import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MY_CLIENTS_QUERY,
  REGENERATE_API_KEY_MUTATION,
  REVOKE_CLIENT_MUTATION,
  SUBSCRIBE_CLIENT_TO_GRAPH_MUTATION,
  UNSUBSCRIBE_CLIENT_FROM_GRAPH_MUTATION,
  MY_ORGANIZATIONS_QUERY,
} from '$lib/server/queries';
import type { Client, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const [clientsData, orgsData] = await Promise.all([
    gqlClient(locals.token).request<{ myClients: Client[] }>(MY_CLIENTS_QUERY)
      .catch(() => ({ myClients: [] as Client[] })),
    gqlClient(locals.token).request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
  ]);

  const client = clientsData.myClients.find((c) => c.id === params.id);
  if (!client) throw error(404, 'Client not found');

  const newKey = url.searchParams.get('newKey') ?? null;
  return { client, newKey, orgs: orgsData.myOrganizations };
};

export const actions: Actions = {
  regenerate: async ({ params, locals }) => {
    try {
      const result = await gqlClient(locals.token).request<{ regenerateApiKey: { rawKey: string } }>(
        REGENERATE_API_KEY_MUTATION, { id: params.id },
      );
      redirect(303, `/app/clients/${params.id}?newKey=${encodeURIComponent(result.regenerateApiKey.rawKey)}`);
    } catch (e: unknown) {
      if ((e as { status?: number }).status === 303) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to regenerate key' });
    }
  },

  revoke: async ({ params, locals }) => {
    const data = await gqlClient(locals.token)
      .request<{ myClients: Array<{ id: string; label: string }> }>(
        /* GraphQL */ `query { myClients { id label } }`,
      ).catch(() => ({ myClients: [] as Array<{ id: string; label: string }> }));
    const client = data.myClients.find((c) => c.id === params.id);
    if (!client) return fail(404, { error: 'Client not found' });
    try {
      await gqlClient(locals.token).request(REVOKE_CLIENT_MUTATION, { label: client.label });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to revoke' });
    }
  },

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const graphId = String(fd.get('graphId') ?? '');
    const subscriptionType = String(fd.get('subscriptionType') ?? 'READ_ONLY');
    const namespace = String(fd.get('namespace') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(SUBSCRIBE_CLIENT_TO_GRAPH_MUTATION, {
        clientId: params.id, graphId, subscriptionType, namespace,
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to subscribe' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const graphId = String(fd.get('graphId') ?? '');
    try {
      await gqlClient(locals.token).request(UNSUBSCRIBE_CLIENT_FROM_GRAPH_MUTATION, { clientId: params.id, graphId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to unsubscribe' });
    }
  },
};
