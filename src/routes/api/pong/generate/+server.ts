import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { json, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  KNOWLEDGE_DOCUMENTS_QUERY,
  PONG_SETTINGS_QUERY,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';
import type { KnowledgeDocument, PongSettings } from '$lib/types';

const PONG_SYSTEM_PROMPT = `You are Pong, an AI email assistant for a university professor. Your job is to draft replies to student emails using ONLY the professor's knowledge base documents provided below.

Rules:
1. ONLY use information from the provided knowledge base documents to answer questions.
2. Match the professor's tone and style if a reply tone is specified.
3. Be helpful, professional, and concise.
4. If the knowledge base does not contain enough information to answer the student's question confidently, say so clearly in the reasoning and give a LOW confidence score.
5. Include the professor's signature if provided.
6. Never fabricate information not present in the knowledge base.

You must respond in JSON format with these fields:
- "draftBody": the email reply body (plain text, no HTML)
- "confidence": a number 0.0–1.0 reflecting how well the knowledge base covers this question
- "sourceDocs": array of document titles used to craft the response
- "reasoning": brief explanation of your confidence level and sources used`;

// Store a draft via the server GraphQL API
const UPSERT_PONG_DRAFT_MUTATION = /* GraphQL */ `
  mutation GeneratePongDraft($connectionId: ID!, $messageId: ID!) {
    generatePongDraft(connectionId: $connectionId, messageId: $messageId) {
      id messageId draftBody confidence status reasoning sourceDocs createdAt
    }
  }
`;

// Lightweight mutation — just stores a pre-generated draft
const STORE_PONG_DRAFT_MUTATION = /* GraphQL */ `
  mutation StorePongDraft(
    $connectionId: ID!, $messageId: ID!, $draftBody: String!,
    $confidence: Float!, $reasoning: String, $sourceDocs: [String!]
  ) {
    storePongDraft(
      connectionId: $connectionId, messageId: $messageId, draftBody: $draftBody,
      confidence: $confidence, reasoning: $reasoning, sourceDocs: $sourceDocs
    ) {
      id messageId draftBody confidence status reasoning sourceDocs createdAt
    }
  }
`;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId, messageId, messageSubject, messageFrom, messageBody } = await request.json();

  if (!connectionId || !messageId) {
    return json({ error: 'connectionId and messageId are required' }, { status: 400 });
  }

  const client = gqlClient(locals.token);

  // Fetch knowledge docs and settings in parallel
  const [docsResult, settingsResult] = await Promise.all([
    client.request<{ knowledgeDocuments: KnowledgeDocument[] }>(
      KNOWLEDGE_DOCUMENTS_QUERY,
      { connectionId },
    ).catch(() => ({ knowledgeDocuments: [] as KnowledgeDocument[] })),
    client.request<{ pongSettings: PongSettings | null }>(
      PONG_SETTINGS_QUERY,
      { connectionId },
    ).catch(() => ({ pongSettings: null })),
  ]);

  const knowledgeDocs = docsResult.knowledgeDocuments;
  const settings = settingsResult.pongSettings;

  if (knowledgeDocs.length === 0) {
    return json({ error: 'No knowledge base documents found. Add documents first.' }, { status: 400 });
  }

  // Build the knowledge base context
  const kbContext = knowledgeDocs
    .map((doc, i) => `--- Document ${i + 1}: ${doc.title} (${doc.docType ?? 'general'}) ---\n${doc.content}`)
    .join('\n\n');

  const toneInstruction = settings?.replyTone
    ? `\nReply tone: ${settings.replyTone}`
    : '';

  const signatureInstruction = settings?.signatureText
    ? `\nAppend this signature at the end of the reply:\n${settings.signatureText}`
    : '';

  const userMessage = `KNOWLEDGE BASE:\n${kbContext}
${toneInstruction}${signatureInstruction}

INCOMING EMAIL:
From: ${messageFrom ?? 'Unknown'}
Subject: ${messageSubject ?? '(no subject)'}
Body:
${messageBody ?? '(empty)'}

Generate a reply draft in JSON format.`;

  // Use Vercel AI SDK to generate the draft
  const apiKey = process.env.PONG_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'Pong AI service not configured (missing API key)' }, { status: 500 });
  }

  const anthropic = createAnthropic({ apiKey });

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: PONG_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxOutputTokens: 1024,
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      draftBody: string;
      confidence: number;
      sourceDocs: string[];
      reasoning: string;
    };

    // Map source doc titles back to IDs
    const sourceDocIds = parsed.sourceDocs
      .map((title) => {
        const doc = knowledgeDocs.find(
          (d) => d.title.toLowerCase() === title.toLowerCase(),
        );
        return doc?.id;
      })
      .filter((id): id is string => !!id);

    return json({
      draftBody: parsed.draftBody,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      sourceDocs: sourceDocIds,
      reasoning: parsed.reasoning,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI generation failed';
    return json({ error: msg }, { status: 500 });
  }
};
