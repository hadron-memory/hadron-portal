/**
 * Pong Chat API endpoint.
 *
 * Extends the standard /api/chat pattern with Pong-specific tool calling:
 * - check_email_integration: verify email connection health
 * - read_inbox_email: fetch emails from inbox
 * - create_draft_reply: generate and store an AI draft
 * - update_settings: change Pong settings via natural language
 * - add_knowledge: save text as a knowledge document
 * - fetch_url_content: extract text from a URL
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, convertToModelMessages, jsonSchema, stepCountIs } from 'ai';
import { gqlClient } from '$lib/server/api';
import {
  STATION_AI_CONFIG_QUERY,
  PONG_SETTINGS_QUERY,
  KNOWLEDGE_DOCUMENTS_QUERY,
  UPSERT_PONG_SETTINGS_MUTATION,
  ADD_KNOWLEDGE_DOCUMENT_MUTATION,
} from '$lib/server/queries';
import { buildPongChatSystemPrompt } from '$lib/pong/system-prompt';
import type { RequestHandler } from './$types';
import type { AIProvider, KnowledgeDocument, PongSettings } from '$lib/types';

function createLanguageModel(provider: AIProvider, apiKey: string, model: string) {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case 'glm': {
      const glm = createOpenAI({
        apiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
      return glm.chat(model);
    }
    default:
      return null;
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, stationId, systemPrompt: connectionId } = await request.json();
  // Note: systemPrompt field carries the connectionId for Pong chat

  if (!stationId || !connectionId) {
    return new Response(
      JSON.stringify({ error: 'stationId and connectionId are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const client = gqlClient(locals.token);

  try {
    // Fetch AI config, settings, and knowledge docs in parallel
    const [aiConfigResult, settingsResult, docsResult] = await Promise.all([
      client.request<{
        stationAIConfig: { provider: string; apiKey: string; model: string } | null;
      }>(STATION_AI_CONFIG_QUERY, { stationId }),
      client.request<{ pongSettings: PongSettings | null }>(
        PONG_SETTINGS_QUERY,
        { connectionId },
      ),
      client.request<{ knowledgeDocuments: KnowledgeDocument[] }>(
        KNOWLEDGE_DOCUMENTS_QUERY,
        { connectionId },
      ),
    ]);

    if (!aiConfigResult.stationAIConfig) {
      return new Response(
        JSON.stringify({ error: 'No AI configuration found for the linked station.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { provider, apiKey, model } = aiConfigResult.stationAIConfig;

    // Build dynamic system prompt
    const pongSystemPrompt = buildPongChatSystemPrompt({
      settings: settingsResult.pongSettings,
      knowledgeDocs: docsResult.knowledgeDocuments,
      connectionId,
      mailboxEmail: '',
      isConnected: true,
    });

    const languageModel = createLanguageModel(provider as AIProvider, apiKey, model);
    if (!languageModel) {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: languageModel,
      system: pongSystemPrompt,
      messages: modelMessages,
      stopWhen: stepCountIs(5),
      tools: {
        update_settings: {
          description: 'Update Pong settings. Use when the professor asks to change confidence threshold, reply tone, auto-send, or signature.',
          inputSchema: jsonSchema<{
            confidenceThreshold?: number;
            replyTone?: string;
            autoSendEnabled?: boolean;
            signatureText?: string;
          }>({
            type: 'object',
            properties: {
              confidenceThreshold: { type: 'number', description: 'Confidence threshold (0.0-1.0). E.g., 0.8 for 80%' },
              replyTone: { type: 'string', description: 'Reply tone, e.g. "formal", "friendly", "casual"' },
              autoSendEnabled: { type: 'boolean', description: 'Whether to auto-send high-confidence replies' },
              signatureText: { type: 'string', description: 'Email signature text' },
            },
          }),
          execute: async (params: { confidenceThreshold?: number; replyTone?: string; autoSendEnabled?: boolean; signatureText?: string }) => {
            try {
              const variables: Record<string, unknown> = { connectionId };
              if (params.confidenceThreshold !== undefined) variables.confidenceThreshold = params.confidenceThreshold;
              if (params.replyTone !== undefined) variables.replyTone = params.replyTone;
              if (params.autoSendEnabled !== undefined) variables.autoSendEnabled = params.autoSendEnabled;
              if (params.signatureText !== undefined) variables.signatureText = params.signatureText;

              await client.request(UPSERT_PONG_SETTINGS_MUTATION, variables);
              return { success: true, message: 'Settings updated successfully', ...params };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to update settings' };
            }
          },
        },

        add_knowledge: {
          description: 'Save text content as a knowledge document. Use when the professor shares context (pastes text, course info, policies, etc.).',
          inputSchema: jsonSchema<{
            title: string;
            content: string;
            docType?: string;
          }>({
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for this document' },
              content: { type: 'string', description: 'The full text content to save' },
              docType: { type: 'string', enum: ['syllabus', 'faq', 'policy', 'template', 'other'], description: 'Document type category' },
            },
            required: ['title', 'content'],
          }),
          execute: async (params: { title: string; content: string; docType?: string }) => {
            try {
              const result = await client.request<{ addKnowledgeDocument: { id: string; title: string } }>(
                ADD_KNOWLEDGE_DOCUMENT_MUTATION,
                { connectionId, ...params },
              );
              return { success: true, documentId: result.addKnowledgeDocument.id, title: result.addKnowledgeDocument.title };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to save document' };
            }
          },
        },

        fetch_url_content: {
          description: 'Fetch a web page and extract its text content. Use when the professor shares a URL for you to read.',
          inputSchema: jsonSchema<{ url: string }>({
            type: 'object',
            properties: {
              url: { type: 'string', description: 'The URL to fetch and extract text from' },
            },
            required: ['url'],
          }),
          execute: async (params: { url: string }) => {
            try {
              const response = await fetch(params.url, {
                headers: { 'User-Agent': 'Pong/1.0 (Hadron Email Agent)' },
              });
              if (!response.ok) {
                return { success: false, error: `Failed to fetch URL: ${response.status} ${response.statusText}` };
              }
              const html = await response.text();
              const text = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim();
              const truncated = text.length > 10000 ? text.slice(0, 10000) + '...(truncated)' : text;
              return { success: true, content: truncated, url: params.url };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to fetch URL' };
            }
          },
        },

        read_inbox_email: {
          description: 'Read emails from the inbox. Use when the professor wants to see their emails or try drafting a reply.',
          inputSchema: jsonSchema<{ count?: number }>({
            type: 'object',
            properties: {
              count: { type: 'number', description: 'Number of emails to fetch (default 5)' },
            },
          }),
          execute: async (params: { count?: number }) => {
            try {
              const LIST_INBOX_QUERY = /* GraphQL */ `
                query ListInbox($connectionId: ID!, $limit: Int) {
                  exchangeInboxMessages(connectionId: $connectionId, limit: $limit) {
                    id subject from receivedDateTime isRead bodyPreview
                  }
                }
              `;
              const result = await client.request<{
                exchangeInboxMessages: Array<{
                  id: string;
                  subject: string;
                  from: string;
                  receivedDateTime: string;
                  isRead: boolean;
                  bodyPreview: string;
                }>;
              }>(LIST_INBOX_QUERY, { connectionId, limit: params.count ?? 5 });
              return { success: true, emails: result.exchangeInboxMessages };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to read inbox' };
            }
          },
        },

        create_draft_reply: {
          description: 'Generate an AI draft reply for a specific email. Use when the professor wants to try drafting a reply to an email.',
          inputSchema: jsonSchema<{
            messageId: string;
            messageSubject?: string;
            messageFrom?: string;
            messageBody?: string;
          }>({
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'The Exchange message ID to reply to' },
              messageSubject: { type: 'string', description: 'Email subject for context' },
              messageFrom: { type: 'string', description: 'Sender email address' },
              messageBody: { type: 'string', description: 'Email body text' },
            },
            required: ['messageId'],
          }),
          execute: async (params: { messageId: string; messageSubject?: string; messageFrom?: string; messageBody?: string }) => {
            try {
              const response = await fetch(new URL('/api/pong/generate', request.url).href, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': request.headers.get('cookie') ?? '',
                },
                body: JSON.stringify({
                  connectionId,
                  ...params,
                }),
              });
              const data = await response.json();
              if (!response.ok) {
                return { success: false, error: data.error };
              }
              return { success: true, ...data };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to generate draft' };
            }
          },
        },

        check_email_integration: {
          description: 'Check if the email integration is connected and healthy.',
          inputSchema: jsonSchema<Record<string, never>>({
            type: 'object',
            properties: {},
          }),
          execute: async () => {
            try {
              const CHECK_QUERY = /* GraphQL */ `
                query CheckConnection($id: ID!) {
                  exchangeConnection(id: $id) {
                    id mailboxEmail syncEnabled syncStatus lastSyncAt lastError
                  }
                }
              `;
              const result = await client.request<{
                exchangeConnection: {
                  id: string;
                  mailboxEmail: string;
                  syncEnabled: boolean;
                  syncStatus: string;
                  lastSyncAt: string | null;
                  lastError: string | null;
                } | null;
              }>(CHECK_QUERY, { id: connectionId });

              if (!result.exchangeConnection) {
                return { success: false, connected: false, error: 'No email connection found' };
              }

              const conn = result.exchangeConnection;
              return {
                success: true,
                connected: true,
                email: conn.mailboxEmail,
                syncEnabled: conn.syncEnabled,
                status: conn.syncStatus,
                lastSync: conn.lastSyncAt,
                error: conn.lastError,
              };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to check connection' };
            }
          },
        },
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chat request failed';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
