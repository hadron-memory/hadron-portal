import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  EXCHANGE_CONNECTION_FIELDS,
} from '$lib/server/queries';
import type { Organization, ExchangeConnection } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

interface ExchangeMessage {
  id: string;
  subject: string | null;
  from: string | null;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  body: string | null;
  hasAttachments: boolean;
}

const EXCHANGE_MESSAGES_QUERY = /* GraphQL */ `
  query ExchangeMessages($connectionId: ID!, $top: Int) {
    exchangeMessages(connectionId: $connectionId, top: $top) {
      id
      subject
      from
      receivedDateTime
      isRead
      bodyPreview
      body
      hasAttachments
    }
  }
`;

const EXCHANGE_REPLY_MUTATION = /* GraphQL */ `
  mutation ExchangeReply($connectionId: ID!, $messageId: ID!, $body: String!) {
    exchangeReply(connectionId: $connectionId, messageId: $messageId, body: $body)
  }
`;

const EXCHANGE_MOVE_MUTATION = /* GraphQL */ `
  mutation ExchangeMoveMessage($connectionId: ID!, $messageId: ID!, $folderId: String!) {
    exchangeMoveMessage(connectionId: $connectionId, messageId: $messageId, folderId: $folderId)
  }
`;

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);

  // Load organization
  const orgData = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY,
    { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });

  if (!orgData.organization) throw error(404, 'Organization not found');

  // Find the specific connection
  const connection = orgData.organization.exchangeConnections?.find(
    (c: ExchangeConnection) => c.id === params.connectionId,
  );
  if (!connection) throw error(404, 'Exchange connection not found');

  // Load messages
  let messages: ExchangeMessage[] = [];
  let loadError: string | null = null;
  try {
    const msgData = await gqlClient(locals.token).request<{ exchangeMessages: ExchangeMessage[] }>(
      EXCHANGE_MESSAGES_QUERY,
      { connectionId: params.connectionId, top: 50 },
    );
    messages = msgData.exchangeMessages;
  } catch (e: unknown) {
    loadError = extractGqlError(e, 'Failed to load emails');
  }

  return {
    org: orgData.organization,
    connection,
    messages,
    loadError,
  };
};

export const actions: Actions = {
  reply: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const messageId = String(fd.get('messageId') ?? '').trim();
    const body = String(fd.get('body') ?? '').trim();
    if (!messageId || !body) {
      return fail(400, { error: 'Message ID and reply body are required' });
    }
    try {
      await gqlClient(locals.token).request(EXCHANGE_REPLY_MUTATION, {
        connectionId: params.connectionId,
        messageId,
        body,
      });
      return { replySent: true, repliedMessageId: messageId };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to send reply') });
    }
  },

  move: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const messageId = String(fd.get('messageId') ?? '').trim();
    const folderId = String(fd.get('folderId') ?? '').trim();
    if (!messageId || !folderId) {
      return fail(400, { error: 'Message ID and folder are required' });
    }
    try {
      await gqlClient(locals.token).request(EXCHANGE_MOVE_MUTATION, {
        connectionId: params.connectionId,
        messageId,
        folderId,
      });
      return { moved: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to move email') });
    }
  },
};
