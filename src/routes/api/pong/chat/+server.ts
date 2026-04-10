/**
 * Pong Chat API endpoint.
 *
 * The chat is the only Pong UI. Every Pong action a user could want is
 * exposed as a tool here so it can be invoked through natural conversation.
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
  DELETE_KNOWLEDGE_DOCUMENT_MUTATION,
  PONG_DRAFTS_QUERY,
  APPROVE_PONG_DRAFT_MUTATION,
  REJECT_PONG_DRAFT_MUTATION,
  EDIT_PONG_DRAFT_MUTATION,
  PAUSE_PONG_MUTATION,
  RESUME_PONG_MUTATION,
  ADD_PONG_EXCLUSION_RULE_MUTATION,
  REMOVE_PONG_EXCLUSION_RULE_MUTATION,
  PONG_STATUS_QUERY,
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
          description: 'Read emails from the inbox. Use when the user wants to see their emails or try drafting a reply.',
          inputSchema: jsonSchema<{ count?: number }>({
            type: 'object',
            properties: {
              count: { type: 'number', description: 'Number of emails to fetch (default 5)' },
            },
          }),
          execute: async (params: { count?: number }) => {
            try {
              const LIST_INBOX_QUERY = /* GraphQL */ `
                query ListInbox($connectionId: ID!, $top: Int) {
                  exchangeMessages(connectionId: $connectionId, top: $top) {
                    id subject from receivedDateTime isRead bodyPreview
                  }
                }
              `;
              const result = await client.request<{
                exchangeMessages: Array<{
                  id: string;
                  subject: string | null;
                  from: string | null;
                  receivedDateTime: string;
                  isRead: boolean;
                  bodyPreview: string;
                }>;
              }>(LIST_INBOX_QUERY, { connectionId, top: params.count ?? 5 });
              return { success: true, emails: result.exchangeMessages };
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to read inbox';
              console.error('[pong chat] read_inbox_email failed:', msg, e);
              return { success: false, error: msg };
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
                query MyExchangeConnections {
                  myExchangeConnections {
                    id mailboxEmail syncEnabled syncStatus lastSyncAt lastError
                  }
                }
              `;
              const result = await client.request<{
                myExchangeConnections: Array<{
                  id: string;
                  mailboxEmail: string;
                  syncEnabled: boolean;
                  syncStatus: string;
                  lastSyncAt: string | null;
                  lastError: string | null;
                }>;
              }>(CHECK_QUERY);

              const conn = result.myExchangeConnections.find((c) => c.id === connectionId);
              if (!conn) {
                return { success: false, connected: false, error: 'No email connection found for this Pong session' };
              }

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
              const msg = e instanceof Error ? e.message : 'Failed to check connection';
              console.error('[pong chat] check_email_integration failed:', msg, e);
              return { success: false, error: msg };
            }
          },
        },

        // ── Draft management ──────────────────────────────────────────────

        list_drafts: {
          description: 'List Pong drafts. Use when the user asks "show my drafts", "what is pending", or wants to review what Pong has prepared.',
          inputSchema: jsonSchema<{ status?: string; limit?: number }>({
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['PENDING', 'APPROVED', 'AUTO_SENT', 'EDITED', 'REJECTED'],
                description: 'Filter by draft status. Omit to show all.',
              },
              limit: { type: 'number', description: 'Max number of drafts to return (default 10)' },
            },
          }),
          execute: async (params: { status?: string; limit?: number }) => {
            try {
              const result = await client.request<{
                pongDrafts: Array<{
                  id: string; messageId: string; messageSubject: string | null;
                  messageFrom: string | null; confidence: number; status: string;
                  createdAt: string; sentAt: string | null;
                }>;
              }>(PONG_DRAFTS_QUERY, { connectionId, status: params.status, limit: params.limit ?? 10 });
              return { success: true, drafts: result.pongDrafts };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to list drafts' };
            }
          },
        },

        read_draft: {
          description: 'Show one Pong draft in full — body, confidence, reasoning, and source documents. Use after list_drafts when the user asks about a specific draft.',
          inputSchema: jsonSchema<{ draftId: string }>({
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'The PongDraft id (from list_drafts)' },
            },
            required: ['draftId'],
          }),
          execute: async (params: { draftId: string }) => {
            try {
              const READ_DRAFT_QUERY = /* GraphQL */ `
                query ReadPongDraft($id: ID!) {
                  pongDraft(id: $id) {
                    id messageId messageSubject messageFrom messageReceivedAt
                    draftBody editedBody confidence status sourceDocs reasoning
                    sentAt createdAt updatedAt
                  }
                }
              `;
              const result = await client.request<{ pongDraft: unknown | null }>(READ_DRAFT_QUERY, { id: params.draftId });
              if (!result.pongDraft) return { success: false, error: 'Draft not found' };
              return { success: true, draft: result.pongDraft };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to read draft' };
            }
          },
        },

        approve_draft: {
          description: 'Send a Pong draft as-is. Use when the user says "send it", "approve", "looks good, send", etc. The original draft body is sent unchanged.',
          inputSchema: jsonSchema<{ draftId: string }>({
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'The PongDraft id to approve and send' },
            },
            required: ['draftId'],
          }),
          execute: async (params: { draftId: string }) => {
            try {
              const result = await client.request<{ approvePongDraft: { id: string; status: string; sentAt: string | null } }>(
                APPROVE_PONG_DRAFT_MUTATION,
                { id: params.draftId },
              );
              return { success: true, status: result.approvePongDraft.status, sentAt: result.approvePongDraft.sentAt };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to approve draft' };
            }
          },
        },

        edit_and_send_draft: {
          description: 'Edit a Pong draft body and send it. Use when the user gives you new wording for a draft and tells you to send. The edit also feeds the learning loop.',
          inputSchema: jsonSchema<{ draftId: string; newBody: string }>({
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'The PongDraft id to edit and send' },
              newBody: { type: 'string', description: 'The new email body to send (replaces the original draft body)' },
            },
            required: ['draftId', 'newBody'],
          }),
          execute: async (params: { draftId: string; newBody: string }) => {
            try {
              const result = await client.request<{ approvePongDraft: { id: string; status: string; sentAt: string | null } }>(
                APPROVE_PONG_DRAFT_MUTATION,
                { id: params.draftId, editedBody: params.newBody },
              );
              return { success: true, status: result.approvePongDraft.status, sentAt: result.approvePongDraft.sentAt };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to send edited draft' };
            }
          },
        },

        save_draft_edit: {
          description: 'Update a Pong draft body without sending it. Use when the user wants to revise wording but is not ready to send yet.',
          inputSchema: jsonSchema<{ draftId: string; newBody: string }>({
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'The PongDraft id to update' },
              newBody: { type: 'string', description: 'The new email body to save' },
            },
            required: ['draftId', 'newBody'],
          }),
          execute: async (params: { draftId: string; newBody: string }) => {
            try {
              await client.request(EDIT_PONG_DRAFT_MUTATION, { id: params.draftId, body: params.newBody });
              return { success: true, message: 'Draft updated. Tell me when you are ready to send.' };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to update draft' };
            }
          },
        },

        reject_draft: {
          description: 'Dismiss a Pong draft without sending. Use when the user says "skip", "discard", "do not reply", etc.',
          inputSchema: jsonSchema<{ draftId: string }>({
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'The PongDraft id to reject' },
            },
            required: ['draftId'],
          }),
          execute: async (params: { draftId: string }) => {
            try {
              await client.request(REJECT_PONG_DRAFT_MUTATION, { id: params.draftId });
              return { success: true, message: 'Draft rejected.' };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to reject draft' };
            }
          },
        },

        // ── Knowledge management ──────────────────────────────────────────

        list_knowledge: {
          description: 'List the knowledge documents Pong is using. Use when the user asks what Pong knows or what context it has.',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute: async () => {
            try {
              const result = await client.request<{
                knowledgeDocuments: Array<{ id: string; title: string; docType: string | null; createdAt: string }>;
              }>(KNOWLEDGE_DOCUMENTS_QUERY, { connectionId });
              return { success: true, documents: result.knowledgeDocuments };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to list knowledge' };
            }
          },
        },

        delete_knowledge: {
          description: 'Remove a knowledge document. Use when the user says "delete that document", "forget the syllabus", etc.',
          inputSchema: jsonSchema<{ documentId: string }>({
            type: 'object',
            properties: {
              documentId: { type: 'string', description: 'The KnowledgeDocument id to delete' },
            },
            required: ['documentId'],
          }),
          execute: async (params: { documentId: string }) => {
            try {
              await client.request(DELETE_KNOWLEDGE_DOCUMENT_MUTATION, { id: params.documentId });
              return { success: true, message: 'Document deleted.' };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to delete document' };
            }
          },
        },

        // ── Pause and exclusion rules ─────────────────────────────────────

        pause_pong: {
          description: 'Pause Pong so it stops drafting replies. Use when the user says "pause Pong", "stop for a week", "I am on vacation", etc.',
          inputSchema: jsonSchema<{ until?: string }>({
            type: 'object',
            properties: {
              until: { type: 'string', description: 'ISO 8601 timestamp when pause should end. Omit to pause indefinitely.' },
            },
          }),
          execute: async (params: { until?: string }) => {
            try {
              const result = await client.request<{ pausePong: { pausedUntil: string | null } }>(
                PAUSE_PONG_MUTATION,
                { connectionId, until: params.until },
              );
              return { success: true, pausedUntil: result.pausePong.pausedUntil };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to pause Pong' };
            }
          },
        },

        resume_pong: {
          description: 'Resume Pong after a pause. Use when the user says "resume", "start again", "I am back", etc.',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute: async () => {
            try {
              await client.request(RESUME_PONG_MUTATION, { connectionId });
              return { success: true, message: 'Pong is active again.' };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to resume Pong' };
            }
          },
        },

        add_exclusion_rule: {
          description: 'Add a rule that tells Pong to skip certain emails. Use when the user says "never reply to HR", "skip newsletters", "ignore emails from no-reply", etc. Provide at least one of senderPattern or subjectPattern.',
          inputSchema: jsonSchema<{ senderPattern?: string; subjectPattern?: string; reason?: string }>({
            type: 'object',
            properties: {
              senderPattern: { type: 'string', description: 'Regex matching the sender email (e.g. "hr@.*\\.edu", "noreply")' },
              subjectPattern: { type: 'string', description: 'Regex matching the email subject (e.g. "newsletter", "out of office")' },
              reason: { type: 'string', description: 'Short reason for this exclusion (shown in logs)' },
            },
          }),
          execute: async (params: { senderPattern?: string; subjectPattern?: string; reason?: string }) => {
            if (!params.senderPattern && !params.subjectPattern) {
              return { success: false, error: 'Provide at least senderPattern or subjectPattern' };
            }
            try {
              const result = await client.request<{
                addPongExclusionRule: { exclusionRules: Array<{ senderPattern: string | null; subjectPattern: string | null; reason: string | null }> };
              }>(ADD_PONG_EXCLUSION_RULE_MUTATION, { connectionId, rule: params });
              return { success: true, exclusionRules: result.addPongExclusionRule.exclusionRules };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to add exclusion rule' };
            }
          },
        },

        remove_exclusion_rule: {
          description: 'Remove an exclusion rule by its index. Use list_exclusion_rules first to see indices.',
          inputSchema: jsonSchema<{ index: number }>({
            type: 'object',
            properties: {
              index: { type: 'number', description: 'Zero-based index of the rule to remove' },
            },
            required: ['index'],
          }),
          execute: async (params: { index: number }) => {
            try {
              const result = await client.request<{
                removePongExclusionRule: { exclusionRules: Array<{ senderPattern: string | null; subjectPattern: string | null; reason: string | null }> };
              }>(REMOVE_PONG_EXCLUSION_RULE_MUTATION, { connectionId, index: params.index });
              return { success: true, exclusionRules: result.removePongExclusionRule.exclusionRules };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to remove exclusion rule' };
            }
          },
        },

        list_exclusion_rules: {
          description: 'Show the current exclusion rules. Use when the user asks what Pong is ignoring.',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute: async () => {
            try {
              const result = await client.request<{
                pongSettings: { exclusionRules: Array<{ senderPattern: string | null; subjectPattern: string | null; reason: string | null }> } | null;
              }>(PONG_SETTINGS_QUERY, { connectionId });
              return { success: true, exclusionRules: result.pongSettings?.exclusionRules ?? [] };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to list exclusion rules' };
            }
          },
        },

        // ── Status / activity ─────────────────────────────────────────────

        show_status: {
          description: 'Show what Pong has been doing recently — counts of drafted, auto-sent, edited, rejected emails, plus pause state. Use when the user asks "how is Pong doing", "what have you done this week", etc.',
          inputSchema: jsonSchema<{ sinceDays?: number }>({
            type: 'object',
            properties: {
              sinceDays: { type: 'number', description: 'Days to look back (default 7)' },
            },
          }),
          execute: async (params: { sinceDays?: number }) => {
            try {
              const result = await client.request<{
                pongStatus: {
                  drafted: number; autoSent: number; approved: number;
                  edited: number; rejected: number; pending: number;
                  pausedUntil: string | null; sinceDays: number;
                };
              }>(PONG_STATUS_QUERY, { connectionId, sinceDays: params.sinceDays });
              return { success: true, ...result.pongStatus };
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Failed to fetch status' };
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
