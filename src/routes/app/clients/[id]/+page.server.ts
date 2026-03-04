import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  CLIENT_QUERY,
  REVOKE_CLIENT_MUTATION,
  SUBSCRIBE_CLIENT_TO_GRAPH_MUTATION,
  UNSUBSCRIBE_CLIENT_FROM_GRAPH_MUTATION,
  MY_ORGANIZATIONS_QUERY,
} from '$lib/server/queries';
import type { Client, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // `params.id` is the client's DB id, but CLIENT_QUERY takes a label.
  // We load from clients list and match by id.
  const [clientsData, orgsData] = await Promise.all([
    gqlClient(locals.token).request<{ clients: Client[] }>(
      /* GraphQL */ `
        query AllClients {
          clients {
            id label type description roles namespace organizationId userId expiresAt createdAt lastUsedAt
            user { id login name avatarUrl }
            graphs { id name source readBranch writeBranch visibility lastSyncedAt organizationId createdAt updatedAt }
          }
        }
      `,
    ).catch(() => ({ clients: [] as Client[] })),
    gqlClient(locals.token).request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY).catch(() => ({ myOrganizations: [] as Organization[] })),
  ]);

  const client = clientsData.clients.find((c) => c.id === params.id);
  if (!client) throw error(404, 'Client not found');

  const newKey = url.searchParams.get('newKey') ?? null;
  return { client, newKey, orgs: orgsData.myOrganizations };
};

export const actions: Actions = {
  revoke: async ({ params, locals }) => {
    // We need the label — load it first
    const data = await gqlClient(locals.token).request<{ clients: Array<{ id: string; label: string }> }>(
      /* GraphQL */ `query { clients { id label } }`,
    ).catch(() => ({ clients: [] as Array<{ id: string; label: string }> }));
    const client = data.clients.find((c) => c.id === params.id);
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
    try {
      await gqlClient(locals.token).request(SUBSCRIBE_CLIENT_TO_GRAPH_MUTATION, { clientId: params.id, graphId });
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
