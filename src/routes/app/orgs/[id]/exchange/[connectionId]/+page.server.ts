import { error, fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORGANIZATION_QUERY,
  EXCHANGE_CONNECTION_FIELDS,
} from '$lib/server/queries';
import type { Organization, ExchangeConnection } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { moveExchangeMessageSchema, replyExchangeMessageSchema } from './schema';

type ReplyExchangeMessageForm = Infer<typeof replyExchangeMessageSchema, 'zod4'>;
type MoveExchangeMessageForm = Infer<typeof moveExchangeMessageSchema, 'zod4'>;

const replyExchangeMessageFormAdapter = zod4(replyExchangeMessageSchema);
const moveExchangeMessageFormAdapter = zod4(moveExchangeMessageSchema);

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

  const [replyForm, moveForm] = await Promise.all([
    superValidate<ReplyExchangeMessageForm>(
      { messageId: '', body: '' },
      replyExchangeMessageFormAdapter,
      { errors: false },
    ),
    superValidate<MoveExchangeMessageForm>(
      { messageId: '', folderId: 'Archive' },
      moveExchangeMessageFormAdapter,
      { errors: false },
    ),
  ]);

  return {
    org: orgData.organization,
    connection,
    messages,
    loadError,
    replyForm,
    moveForm,
  };
};

export const actions: Actions = {
  reply: async ({ request, params, locals }) => {
    const form = await superValidate<ReplyExchangeMessageForm>(
      await request.formData(),
      replyExchangeMessageFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(EXCHANGE_REPLY_MUTATION, {
        connectionId: params.connectionId,
        messageId: form.data.messageId,
        body: form.data.body,
      });
      return message(form, {
        type: 'success',
        text: t('org.exchange.reply.sent', 'Reply sent successfully.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to send reply') },
        { status: 500 },
      );
    }
  },

  move: async ({ request, params, locals }) => {
    const form = await superValidate<MoveExchangeMessageForm>(
      await request.formData(),
      moveExchangeMessageFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(EXCHANGE_MOVE_MUTATION, {
        connectionId: params.connectionId,
        messageId: form.data.messageId,
        folderId: form.data.folderId,
      });
      return message(form, {
        type: 'success',
        text: t('org.exchange.move.moved', 'Email moved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to move email') },
        { status: 500 },
      );
    }
  },
};
