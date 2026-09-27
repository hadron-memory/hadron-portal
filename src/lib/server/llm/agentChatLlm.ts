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

// ── Which configs this runtime may run (stopgap, Holger 2026-09-27) ─────────
//
// This runtime calls providers from the PORTAL with the config's decrypted key,
// at the hosts below, and knows nothing of a config's endpoint. A config whose
// endpoint was set elsewhere (the CLI, the API) would otherwise be run against
// one of these hosts with a key issued for a different one. So it runs only
// configs whose server-resolved effective endpoint IS a host it calls, and
// refuses the rest loudly.
//
// The direction (Holger): custom endpoints are called only by the server, which
// has the egress guard for them, and portal chat turns move there. Until then
// this is the containment, not the fix.

/** The GLM host this runtime has always called (Z.ai Coding Plan). */
const GLM_PORTAL_HOST = 'https://api.z.ai/api/coding/paas/v4';

/**
 * Per provider, the effective endpoints this runtime may run. `null`: the
 * provider has no endpoint (the SDK derives it), so a config must have none.
 *
 * GLM also admits the server's default (general) host although this runtime
 * calls the Coding Plan host. That mismatch predates the stopgap and needs its
 * own decision (some users rely on Coding Plan keys), so it is kept as it was.
 */
const PORTAL_RUNTIME_HOSTS: Readonly<Record<string, readonly string[] | null>> = {
  anthropic: ['https://api.anthropic.com/v1'],
  openai: ['https://api.openai.com/v1'],
  glm: [GLM_PORTAL_HOST, 'https://api.z.ai/api/paas/v4'],
  bedrock: null,
};

/**
 * Whether two endpoints name the same place. Scheme and host are compared
 * case-insensitively (URL normalizes them, and a default port); the PATH is
 * case-sensitive, so `/V1` is not `/v1` (Codex on #958). Only a trailing slash
 * is ignored, and any query or fragment makes it a different endpoint.
 */
function sameEndpoint(a: string, b: string): boolean {
  const parse = (u: string) => {
    try {
      return new URL(u.trim());
    } catch {
      return null;
    }
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  const path = (u: URL) => u.pathname.replace(/\/+$/, '');
  return pa.origin === pb.origin && path(pa) === path(pb) && pa.search === pb.search && pa.hash === pb.hash;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Why this runtime must not run a resolved config, or null when it may.
 * `effectiveEndpoint` is the server's (ResolvedAiConfig): where a request for
 * the config is meant to go. What can't be checked is refused, not assumed.
 */
export function portalRuntimeRefusal(config: { provider: string; effectiveEndpoint?: string | null }): string | null {
  const { provider } = config;
  const endpoint = config.effectiveEndpoint ?? null;
  if (!Object.hasOwn(PORTAL_RUNTIME_HOSTS, provider)) {
    return `This AI configuration uses the "${provider}" provider, which portal chats can't run yet: only the Hadron server calls it. Until portal chats run on the server, use a configuration with a built-in provider.`;
  }
  const hosts = PORTAL_RUNTIME_HOSTS[provider];
  if (hosts === null) {
    return endpoint === null
      ? null
      : `This AI configuration has an endpoint (${hostOf(endpoint)}), which portal chats can't use for ${provider}. Remove the endpoint, or use another configuration.`;
  }
  if (endpoint === null) {
    return `Portal chats couldn't confirm where this AI configuration sends requests, so they won't run it. Check the configuration's endpoint, or use another configuration.`;
  }
  if (!hosts.some((h) => sameEndpoint(h, endpoint))) {
    return `This AI configuration sends requests to a custom endpoint (${hostOf(endpoint)}), which portal chats can't use yet: custom endpoints are called only by the Hadron server. Until portal chats run on the server, use a configuration on the provider's default endpoint.`;
  }
  return null;
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
        baseURL: GLM_PORTAL_HOST,
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

  // Welcome turn has an empty history, but the AI SDK requires at least one
  // message. Seed a minimal synthetic user turn so the LLM produces a greeting
  // driven by the stage's system prompt.
  const effectiveMessages = messages.length === 0
    ? [{ role: 'user' as const, content: 'Please begin the conversation.' }]
    : messages;

  // Normalize the system prompt before handing it to the SDK.
  //   - The Bedrock Converse adapter (and others) splits the system string
  //     into structured blocks; a trailing empty segment trips the API's
  //     "system.N.member.text" length-≥-1 validation.
  //   - An empty / whitespace-only string can yield an empty block at
  //     index 0; preferring `undefined` over `""` keeps providers from
  //     constructing a degenerate system payload at all.
  //   - Trim trailing whitespace specifically because the chat-bootstrap
  //     path can produce strings like `"<agent prompt>\n\n"` when a stage
  //     prompt is empty (see startChat resolver).
  const trimmedSystem = systemMessage.trim();
  const systemForSdk = trimmedSystem.length > 0 ? trimmedSystem : undefined;

  // Find the respond tool. Hadron always ships a single tool per stage but
  // the array shape leaves room for more later.
  const respondTool = (args.tools ?? []).find((t) => t.name === 'respond');
  if (!respondTool) {
    // No extraction spec on this stage — fall back to plain text and wrap
    // it as a synthetic respond() call so the downstream processChatResponse
    // path still works.
    const result = await generateText({
      model: languageModel,
      system: systemForSdk,
      messages: effectiveMessages.map((m) => ({ role: m.role, content: m.content })),
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
  // extractionSpec — no Zod conversion needed. The cast to `any` on the
  // `tool({...})` arg works around an SDK overload that can't reconcile
  // an untyped jsonSchema with a typed execute.
  const respondVercelTool = tool({
    description: respondTool.description ?? 'Respond to the user and extract data',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: jsonSchema(respondTool.parameters as any),
    execute: async (input: RespondCall) => input,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const result = await generateText({
    model: languageModel,
    system: systemForSdk,
    messages: effectiveMessages.map((m) => ({ role: m.role, content: m.content })),
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
