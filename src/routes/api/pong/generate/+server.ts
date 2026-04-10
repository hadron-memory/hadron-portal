import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  PONG_KNOWLEDGE_QUERY,
  PONG_SETTINGS_QUERY,
  STATION_AI_CONFIG_QUERY,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';
import type { AIProvider, PongKnowledge, PongSettings } from '$lib/types';

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
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId, messageId, messageSubject, messageFrom, messageBody } = await request.json();

  if (!connectionId || !messageId) {
    return json({ error: 'connectionId and messageId are required' }, { status: 400 });
  }

  const client = gqlClient(locals.token);

  // Fetch knowledge docs and settings in parallel
  const [docsResult, settingsResult] = await Promise.all([
    client.request<{ pongKnowledge: PongKnowledge[] }>(
      PONG_KNOWLEDGE_QUERY,
      { connectionId },
    ).catch(() => ({ pongKnowledge: [] as PongKnowledge[] })),
    client.request<{ pongSettings: PongSettings | null }>(
      PONG_SETTINGS_QUERY,
      { connectionId },
    ).catch(() => ({ pongSettings: null })),
  ]);

  const knowledgeDocs = docsResult.pongKnowledge;
  const settings = settingsResult.pongSettings;

  if (knowledgeDocs.length === 0) {
    return json({ error: 'No knowledge base documents found. Add documents first.' }, { status: 400 });
  }

  // Get AI config from the linked station
  if (!settings?.stationId) {
    return json({ error: 'No station linked to Pong. Configure a station with AI settings in Pong Settings.' }, { status: 400 });
  }

  let provider: string;
  let apiKey: string;
  let model: string;

  try {
    const result = await client.request<{
      stationAIConfig: { provider: string; apiKey: string; model: string } | null;
    }>(STATION_AI_CONFIG_QUERY, { stationId: settings.stationId });

    if (!result.stationAIConfig) {
      return json({ error: 'The linked station has no AI configuration. Set up AI provider and API key on the station first.' }, { status: 400 });
    }

    provider = result.stationAIConfig.provider;
    apiKey = result.stationAIConfig.apiKey;
    model = result.stationAIConfig.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch station AI config';
    return json({ error: msg }, { status: 500 });
  }

  const languageModel = createLanguageModel(provider as AIProvider, apiKey, model);
  if (!languageModel) {
    return json({ error: `Unsupported AI provider: ${provider}` }, { status: 400 });
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

  try {
    const result = await generateText({
      model: languageModel,
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
