import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { streamText, convertToModelMessages } from 'ai';
import type { RequestHandler } from './$types';
import type { AIProvider } from '$lib/types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, provider, apiKey, model } = await request.json();

  if (!apiKey || !provider || !model) {
    return new Response(
      JSON.stringify({ error: 'AI provider configuration is required (provider, apiKey, model)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

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
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
};

function createLanguageModel(provider: AIProvider, apiKey: string, model: string) {
  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(model);
    }
    case 'xai': {
      const xai = createXai({ apiKey });
      return xai(model);
    }
    case 'glm': {
      const glm = createOpenAI({
        apiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
      return glm(model);
    }
    default:
      return null;
  }
}
