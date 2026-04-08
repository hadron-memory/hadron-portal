import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MY_EXCHANGE_CONNECTIONS_QUERY,
  KNOWLEDGE_DOCUMENTS_QUERY,
  ADD_KNOWLEDGE_DOCUMENT_MUTATION,
  UPDATE_KNOWLEDGE_DOCUMENT_MUTATION,
  DELETE_KNOWLEDGE_DOCUMENT_MUTATION,
  PONG_DRAFTS_QUERY,
  STORE_PONG_DRAFT_MUTATION,
  APPROVE_PONG_DRAFT_MUTATION,
  REJECT_PONG_DRAFT_MUTATION,
  PONG_SETTINGS_QUERY,
  UPSERT_PONG_SETTINGS_MUTATION,
} from '$lib/server/queries';
import type { ExchangeConnection, KnowledgeDocument, PongDraft, PongSettings } from '$lib/types';
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

export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  // Load user's exchange connections and find the one matching the route
  const data = await client.request<{ myExchangeConnections: ExchangeConnection[] }>(
    MY_EXCHANGE_CONNECTIONS_QUERY,
  ).catch(() => { throw error(404, 'Connection not found'); });

  const connection = data.myExchangeConnections.find(
    (c: ExchangeConnection) => c.id === params.connectionId,
  );
  if (!connection) throw error(404, 'Exchange connection not found');

  // Load messages, knowledge docs, pong drafts, and settings in parallel
  const [messagesResult, docsResult, draftsResult, settingsResult] = await Promise.all([
    client.request<{ exchangeMessages: ExchangeMessage[] }>(
      EXCHANGE_MESSAGES_QUERY,
      { connectionId: params.connectionId, top: 50 },
    ).catch(() => ({ exchangeMessages: [] as ExchangeMessage[] })),

    client.request<{ knowledgeDocuments: KnowledgeDocument[] }>(
      KNOWLEDGE_DOCUMENTS_QUERY,
      { connectionId: params.connectionId },
    ).catch(() => ({ knowledgeDocuments: [] as KnowledgeDocument[] })),

    client.request<{ pongDrafts: PongDraft[] }>(
      PONG_DRAFTS_QUERY,
      { connectionId: params.connectionId, limit: 50 },
    ).catch(() => ({ pongDrafts: [] as PongDraft[] })),

    client.request<{ pongSettings: PongSettings | null }>(
      PONG_SETTINGS_QUERY,
      { connectionId: params.connectionId },
    ).catch(() => ({ pongSettings: null })),
  ]);

  return {
    connection,
    messages: messagesResult.exchangeMessages,
    knowledgeDocs: docsResult.knowledgeDocuments,
    pongDrafts: draftsResult.pongDrafts,
    pongSettings: settingsResult.pongSettings,
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

  // ── Knowledge base actions ──────────────────────────────────────────

  addDocument: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const title = String(fd.get('title') ?? '').trim();
    const content = String(fd.get('content') ?? '').trim();
    const docType = String(fd.get('docType') ?? '').trim() || null;
    if (!title || !content) {
      return fail(400, { error: 'Title and content are required' });
    }
    try {
      await gqlClient(locals.token).request(ADD_KNOWLEDGE_DOCUMENT_MUTATION, {
        connectionId: params.connectionId,
        title,
        content,
        docType,
      });
      return { docAdded: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to add document') });
    }
  },

  updateDocument: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '').trim();
    const title = String(fd.get('title') ?? '').trim() || undefined;
    const content = String(fd.get('content') ?? '').trim() || undefined;
    const docType = String(fd.get('docType') ?? '').trim() || undefined;
    if (!id) return fail(400, { error: 'Document ID is required' });
    try {
      await gqlClient(locals.token).request(UPDATE_KNOWLEDGE_DOCUMENT_MUTATION, {
        id,
        title,
        content,
        docType,
      });
      return { docUpdated: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update document') });
    }
  },

  deleteDocument: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '').trim();
    if (!id) return fail(400, { error: 'Document ID is required' });
    try {
      await gqlClient(locals.token).request(DELETE_KNOWLEDGE_DOCUMENT_MUTATION, { id });
      return { docDeleted: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to delete document') });
    }
  },

  // ── Pong draft actions ──────────────────────────────────────────────

  generateDraft: async ({ request, params, locals, url, fetch }) => {
    const fd = await request.formData();
    const messageId = String(fd.get('messageId') ?? '').trim();
    const messageSubject = String(fd.get('messageSubject') ?? '').trim() || null;
    const messageFrom = String(fd.get('messageFrom') ?? '').trim() || null;
    const messageBody = String(fd.get('messageBody') ?? '').trim() || null;
    if (!messageId) return fail(400, { error: 'Message ID is required' });

    try {
      // Step 1: Generate AI draft via portal API route (uses Vercel AI SDK)
      const aiResponse = await fetch('/api/pong/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: params.connectionId,
          messageId,
          messageSubject,
          messageFrom,
          messageBody,
        }),
      });

      if (!aiResponse.ok) {
        const errData = await aiResponse.json().catch(() => ({ error: 'AI generation failed' }));
        return fail(500, { error: errData.error ?? 'AI generation failed' });
      }

      const aiResult = await aiResponse.json() as {
        draftBody: string;
        confidence: number;
        sourceDocs: string[];
        reasoning: string;
      };

      // Step 2: Store the draft via GraphQL
      const result = await gqlClient(locals.token).request<{ storePongDraft: any }>(
        STORE_PONG_DRAFT_MUTATION,
        {
          connectionId: params.connectionId,
          messageId,
          draftBody: aiResult.draftBody,
          confidence: aiResult.confidence,
          reasoning: aiResult.reasoning,
          sourceDocs: aiResult.sourceDocs,
          messageSubject,
          messageFrom,
        },
      );

      return { draftGenerated: true, draft: result.storePongDraft };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to generate draft') });
    }
  },

  approveDraft: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '').trim();
    const editedBody = String(fd.get('editedBody') ?? '').trim() || undefined;
    if (!id) return fail(400, { error: 'Draft ID is required' });
    try {
      await gqlClient(locals.token).request(APPROVE_PONG_DRAFT_MUTATION, { id, editedBody });
      return { draftApproved: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to approve draft') });
    }
  },

  rejectDraft: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '').trim();
    if (!id) return fail(400, { error: 'Draft ID is required' });
    try {
      await gqlClient(locals.token).request(REJECT_PONG_DRAFT_MUTATION, { id });
      return { draftRejected: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to reject draft') });
    }
  },

  // ── Pong settings ───────────────────────────────────────────────────

  saveSettings: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const autoSendEnabled = fd.get('autoSendEnabled') === 'on';
    const confidenceThreshold = parseFloat(String(fd.get('confidenceThreshold') ?? '0.95'));
    const replyTone = String(fd.get('replyTone') ?? '').trim() || null;
    const signatureText = String(fd.get('signatureText') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPSERT_PONG_SETTINGS_MUTATION, {
        connectionId: params.connectionId,
        autoSendEnabled,
        confidenceThreshold,
        replyTone,
        signatureText,
      });
      return { settingsSaved: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to save settings') });
    }
  },
};
