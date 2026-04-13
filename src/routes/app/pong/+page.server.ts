import { redirect, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MY_EXCHANGE_CONNECTIONS_QUERY,
  MY_STATIONS_QUERY,
  PONG_SETTINGS_QUERY,
  PONG_KNOWLEDGE_QUERY,
  UPSERT_PONG_SETTINGS_MUTATION,
} from '$lib/server/queries';
import type { ExchangeConnection, PongKnowledge, PongSettings, Station } from '$lib/types';
import type { PageServerLoad, Actions } from './$types';

/**
 * Top-level Pong page. The chat is the only Pong UI, and from here the user
 * can do everything Pong can do without ever visiting the Account page tabs.
 *
 * Routing rules (option 2 — chat scoped per mailbox):
 * - If the user has no Exchange connections → show a "connect your email" prompt
 * - If the user has exactly one connection → load chat scoped to that mailbox
 * - If the user has several → show a picker (?mailbox=<id> selects one)
 */
export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.token) throw redirect(303, '/login');
  const client = gqlClient(locals.token);

  const { myExchangeConnections } = await client
    .request<{ myExchangeConnections: ExchangeConnection[] }>(MY_EXCHANGE_CONNECTIONS_QUERY)
    .catch(() => ({ myExchangeConnections: [] as ExchangeConnection[] }));

  // No mailboxes — render the connect prompt.
  if (myExchangeConnections.length === 0) {
    return {
      mode: 'no-connection' as const,
      connections: [],
      activeConnection: null,
      pongSettings: null,
      knowledgeDocs: [],
      chatbotStations: [],
    };
  }

  // Pick the active mailbox: ?mailbox=... wins, else first.
  const mailboxParam = url.searchParams.get('mailbox');
  const activeConnection =
    (mailboxParam && myExchangeConnections.find((c) => c.id === mailboxParam)) ||
    myExchangeConnections[0];

  // Multiple mailboxes and no explicit pick → show picker.
  if (myExchangeConnections.length > 1 && !mailboxParam) {
    return {
      mode: 'picker' as const,
      connections: myExchangeConnections,
      activeConnection: null,
      pongSettings: null,
      knowledgeDocs: [],
      chatbotStations: [],
    };
  }

  // Single mailbox or explicit pick → load chat context.
  const [settingsResult, docsResult, stationsResult] = await Promise.all([
    client
      .request<{ pongSettings: PongSettings | null }>(PONG_SETTINGS_QUERY, {
        connectionId: activeConnection.id,
      })
      .catch(() => ({ pongSettings: null })),
    client
      .request<{ pongKnowledge: PongKnowledge[] }>(PONG_KNOWLEDGE_QUERY, {
        connectionId: activeConnection.id,
      })
      .catch(() => ({ pongKnowledge: [] as PongKnowledge[] })),
    client
      .request<{ myStations: Station[] }>(MY_STATIONS_QUERY)
      .catch(() => ({ myStations: [] as Station[] })),
  ]);

  const allStations = stationsResult.myStations.filter(
    (s) => s.stationType === 'CHATBOT',
  );
  const chatbotStations = allStations.filter((s) => s.hasAiApiKey);

  return {
    mode: 'chat' as const,
    connections: myExchangeConnections,
    activeConnection,
    pongSettings: settingsResult.pongSettings,
    knowledgeDocs: docsResult.pongKnowledge,
    chatbotStations,
    allStations,
  };
};

export const actions: Actions = {
  linkStation: async ({ request, locals }) => {
    if (!locals.token) throw redirect(303, '/login');
    const formData = await request.formData();
    const connectionId = formData.get('connectionId');
    const stationId = formData.get('stationId');
    if (typeof connectionId !== 'string' || typeof stationId !== 'string') {
      return fail(400, { setupError: 'Missing required fields' });
    }
    try {
      await gqlClient(locals.token).request(UPSERT_PONG_SETTINGS_MUTATION, {
        connectionId,
        stationId,
      });
      return { linked: true };
    } catch (e) {
      return fail(500, {
        setupError: e instanceof Error ? e.message : 'Failed to link station',
      });
    }
  },
};
