import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool, jsonSchema } from 'ai';
import type { AIProvider } from '$lib/types';

/**
 * The tool-use response shape returned by the `respond` tool. This is the
 * contract between the Chat API prompt and the LLM: every assistant turn
 * MUST come back as a respond() call with these fields.
 */
export interface RespondCall {
  message: string;
  data?: Record<string, unknown>;
  next_stage?: string | null;
}

/**
 * Hadron's tools array as returned by startChat / sendChatMessage. Currently
 * always a single `respond` tool with a parameters JSON schema derived from
 * the stage's extraction spec.
 */
export interface HadronTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface AgentChatLlmResult {
  respond: RespondCall;
  rawText: string;        // For debugging / error messages
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Build a Vercel AI SDK language model instance for a given Hadron agent
 * provider / model / key triple. The three providers we support cover the
 * existing portal setup.
 */
export function createLanguageModel(provider: AIProvider, apiKey: string, model: string) {
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
      // GLM is OpenAI-compatible at the /v4 endpoint.
      const glm = createOpenAI({
        apiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
      return glm.chat(model);
    }
    case 'bedrock': {
      // apiKey is JSON-encoded: {"accessKeyId":"...","secretAccessKey":"...","region":"us-east-1"}
      const creds = JSON.parse(apiKey) as { accessKeyId: string; secretAccessKey: string; region: string };
      const bedrock = createAmazonBedrock({
        region: creds.region,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      });
      return bedrock(model);
    }
    default:
      return null;
  }
}

/**
 * Run one Chat API turn against the configured LLM and return the parsed
 * `respond` tool call. Throws when the LLM fails to produce a tool call.
 *
 * `messages` is the message history Hadron returned from sendChatMessage
 * (or an empty array for turn zero / welcome).
 */
export async function callAgentChatLlm(args: {
  provider: AIProvider;
  apiKey: string;
  model: string;
  systemMessage: string;
  tools: HadronTool[] | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<AgentChatLlmResult> {
  const { provider, apiKey, model, systemMessage, messages } = args;
  const languageModel = createLanguageModel(provider, apiKey, model);
  if (!languageModel) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Find the respond tool. Hadron always ships a single tool per stage but
  // the array shape leaves room for more later.
  const respondTool = (args.tools ?? []).find((t) => t.name === 'respond');
  if (!respondTool) {
    // No extraction spec on this stage — fall back to plain text and wrap
    // it as a synthetic respond() call so the downstream processChatResponse
    // path still works.
    const result = await generateText({
      model: languageModel,
      system: systemMessage,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return {
      respond: { message: result.text, data: {}, next_stage: null },
      rawText: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
    };
  }

  // Force the LLM to use the respond tool. jsonSchema() accepts a raw JSON
  // Schema object, which is what Hadron gives us from the stage's
  // extractionSpec — no Zod conversion needed.
  const respondVercelTool = tool({
    description: respondTool.description ?? 'Respond to the user and extract data',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: jsonSchema(respondTool.parameters as any),
    execute: async (input: RespondCall) => input,
  });

  const result = await generateText({
    model: languageModel,
    system: systemMessage,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools: { respond: respondVercelTool },
    // Force the LLM to call the respond tool on every turn. This is the
    // contract of the Chat API: one tool call per turn, no free-form text.
    toolChoice: { type: 'tool', toolName: 'respond' },
    // A single "step" is one tool call — the SDK would otherwise run the
    // tool and loop for a follow-up text generation, which we don't want.
    stopWhen: ({ steps }) => steps.length >= 1,
  });

  // Walk the content parts for the first tool call. Different providers
  // surface tool calls slightly differently through the SDK; we take the
  // first one we find on the last step.
  const lastStep = result.steps[result.steps.length - 1];
  const toolCalls = lastStep?.content.filter((c) => c.type === 'tool-call') ?? [];
  const firstCall = toolCalls[0] as { toolName?: string; input?: unknown } | undefined;

  if (!firstCall || firstCall.toolName !== 'respond') {
    throw new Error(
      `LLM did not produce a respond() tool call. Got text: ${result.text?.slice(0, 200) ?? '(empty)'}`,
    );
  }

  const respondInput = firstCall.input as RespondCall;
  return {
    respond: respondInput,
    rawText: result.text ?? '',
    usage: {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    },
  };
}
