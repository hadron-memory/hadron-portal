import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MY_ORGANIZATIONS_QUERY,
  MY_CLIENTS_QUERY,
  MY_INVITES_QUERY,
  ACCEPT_INVITE_MUTATION,
  DECLINE_INVITE_MUTATION,
} from '$lib/server/queries';
import type { Organization, Client, OrgInvite } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const apiClient = gqlClient(locals.token);
  const [orgsData, clientsData, invitesData] = await Promise.all([
    apiClient.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY).catch(() => ({ myOrganizations: [] as Organization[] })),
    apiClient.request<{ myClients: Client[] }>(MY_CLIENTS_QUERY).catch(() => ({ myClients: [] as Client[] })),
    apiClient.request<{ myInvites: OrgInvite[] }>(MY_INVITES_QUERY).catch(() => ({ myInvites: [] as OrgInvite[] })),
  ]);
  return {
    orgs: orgsData.myOrganizations,
    clients: clientsData.myClients,
    invites: invitesData.myInvites,
  };
};

export const actions: Actions = {
  acceptInvite: async ({ request, locals }) => {
    const fd = await request.formData();
    const inviteId = String(fd.get('inviteId') ?? '');
    try {
      await gqlClient(locals.token).request(ACCEPT_INVITE_MUTATION, { inviteId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to accept invite' });
    }
  },

  declineInvite: async ({ request, locals }) => {
    const fd = await request.formData();
    const inviteId = String(fd.get('inviteId') ?? '');
    try {
      await gqlClient(locals.token).request(DECLINE_INVITE_MUTATION, { inviteId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to decline invite' });
    }
  },
};
