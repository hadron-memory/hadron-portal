import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { gqlClient } from '$lib/server/api';
import {
  ME_QUERY,
  UPDATE_MY_PROFILE_MUTATION,
  INVITE_USER_MUTATION,
  MY_EXCHANGE_CONNECTIONS_QUERY,
  DELETE_EXCHANGE_CONNECTION_MUTATION,
  TEST_EXCHANGE_CONNECTION_MUTATION,
} from '$lib/server/queries';
import type { ExchangeConnection } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const [userData, exchangeData] = await Promise.all([
    gqlClient(locals.token)
      .request<{ me: Record<string, unknown> | null }>(ME_QUERY)
      .catch(() => ({ me: null })),
    gqlClient(locals.token)
      .request<{ myExchangeConnections: ExchangeConnection[] }>(MY_EXCHANGE_CONNECTIONS_QUERY)
      .catch(() => ({ myExchangeConnections: [] })),
  ]);
  return {
    user: userData.me ?? locals.user,
    exchangeConnections: exchangeData.myExchangeConnections,
  };
};

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || null;
    const handle = String(fd.get('handle') ?? '').trim() || null;
    const email = String(fd.get('email') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPDATE_MY_PROFILE_MUTATION, { name, handle, email });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update profile' });
    }
  },

  invite: async ({ request, locals, url }) => {
    const fd = await request.formData();
    const name = String(fd.get('inviteName') ?? '').trim() || null;
    const email = String(fd.get('inviteEmail') ?? '').trim() || null;
    const githubUsername = String(fd.get('inviteGithub') ?? '').trim() || null;
    try {
      const data = await gqlClient(locals.token).request<{ inviteUser: { slug: string } }>(
        INVITE_USER_MUTATION,
        { name, email, githubUsername, maxActivations: 1, expiresInDays: 30 },
      );
      const inviteUrl = `${url.origin}/invite/${data.inviteUser.slug}`;
      return { invited: true, inviteUrl };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to send invitation' });
    }
  },

  connectExchange: async ({ locals }) => {
    const serverUrl = env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
    const authUrl = `${serverUrl}/auth/microsoft?redirect=${encodeURIComponent('/app/account')}&token=${locals.token}`;
    redirect(303, authUrl);
  },

  disconnectExchange: async ({ request, locals }) => {
    const fd = await request.formData();
    const connectionId = String(fd.get('connectionId') ?? '').trim();
    if (!connectionId) return fail(400, { exchangeError: 'Connection ID is required' });
    try {
      await gqlClient(locals.token).request(DELETE_EXCHANGE_CONNECTION_MUTATION, { id: connectionId });
      return { exchangeDisconnected: true };
    } catch (e: unknown) {
      return fail(500, { exchangeError: extractGqlError(e, 'Failed to disconnect') });
    }
  },

  testExchange: async ({ request, locals }) => {
    const fd = await request.formData();
    const connectionId = String(fd.get('connectionId') ?? '').trim();
    if (!connectionId) return fail(400, { exchangeError: 'Connection ID is required' });
    try {
      await gqlClient(locals.token).request(TEST_EXCHANGE_CONNECTION_MUTATION, { id: connectionId });
      return { exchangeTested: true };
    } catch (e: unknown) {
      return fail(500, { exchangeError: extractGqlError(e, 'Test failed') });
    }
  },
};
