import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, RetryError, generateText, tool, jsonSchema } from 'ai';
import type { AIProvider } from '$lib/types';
import { AI_CONFIG_TEST_DEADLINE_MS } from '$lib/ai-config-deadline';
import { ChatError } from './chatError.js';
import type { ChatToolChoice } from './chatToolChoice.js';

/**
 * The tool-use response shape returned by the `respond` tool. This is the
 * contract between the Chat API prompt and the LLM: every assistant turn
 * MUST come back as a respond() call with these fields.
 */
export interface RespondCall {
  message: string;
  data?: Record<string, unknown>;
  next_stage?: string | null;
  /** S8 (#2065): the model's explicit "this conversation's goal is reached" flag; absent means false. The tool schema stays server-owned. */
  goal_reached?: boolean;
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

// ── Which configs this runtime may run: see $lib/llm/portalRuntime (portal#1963 moved it there, client-safe). ──
import { GLM_PORTAL_HOST } from '$lib/llm/portalRuntime';
export {
  portalRuntimeRefusal,
  isMissingEffectiveEndpoint,
  EFFECTIVE_ENDPOINT_UNSUPPORTED,
} from '$lib/llm/portalRuntime';

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
  /** Inline config probe only: one bounded request and exactly one string-message respond call. */
  respondTest?: true;
  /** Server-owned per-chat or unsaved-pair decision; absent stays forced. */
  toolChoice?: ChatToolChoice | null;
}): Promise<AgentChatLlmResult> {
  const trace: LlmTrace = { stage: 'config' };
  try {
    return await callAgentChatLlmUnsafe(args, trace);
  } catch (e) {
    // SDK errors can contain the request Authorization header. Do not attach
    // the original error as a cause, and never hand it (or anything read off
    // it) to a logger: #1979 logs one closed line built from this module's own
    // vocabulary and integers, and nothing else.
    logLlmFailure(e, () => ({
      stage: trace.stage,
      branch: trace.branch ?? (args.tools?.some((t) => t.name === 'respond') ? 'respond' : 'plain'),
      turn: args.messages.length === 0 ? 'welcome' : 'turn',
      provider: args.provider,
      tools: args.tools?.length ?? 0,
      // Derived from the args, not the trace, so a failure before the request stage still names it.
      choice: args.tools?.some((t) => t.name === 'respond') ? (args.toolChoice === 'AUTO' ? 'auto' : 'forced') : 'none',
      noRespond: trace.noRespond === true,
    }));
    throw new ChatError('llmFailed');
  }
}

// ── #1979: the closed diagnostic line for a failed AI turn ──────────────────
//
// The public error stays the fixed llmFailed. The server log gets ONE line made
// only of: this module's finite vocabulary below, and integers. A provider
// message, response body, error name/class, request id, model, prompt, config or
// App name are all attacker- or user-controlled and may echo a credential, so
// none is read into the line; the provider's own `error.type` appears only when
// it equals an entry of a code allowlist (the allowlist's constant is logged,
// never the input). Status alone does not say WHY a request failed; the line
// keeps that uncertainty by saying only what class of boundary it came from.

/** Where in one turn the failure happened, set by the call itself, not read from the error. */
type LlmStage = 'config' | 'request' | 'tool-output';
type LlmBranch = 'plain' | 'respond';
/** `none`: no respond tool, so no tool choice was made (plain branch). */
type LlmChoice = 'auto' | 'forced' | 'none';
/** `noRespond` is set by the call itself (#2036), never read from the error or the reply. */
interface LlmTrace { stage: LlmStage; branch?: LlmBranch; noRespond?: boolean }
interface LlmFailureContext { stage: LlmStage; branch: LlmBranch; turn: 'welcome' | 'turn'; provider: AIProvider; tools: number; choice: LlmChoice; noRespond?: boolean }

/** Every field of the line comes out of one of these lists (or an integer), never from the input. */
export const LOGGABLE_PROVIDERS = ['anthropic', 'openai', 'glm', 'bedrock'] as const satisfies readonly AIProvider[];
const LOGGABLE_STAGES = ['config', 'request', 'tool-output'] as const satisfies readonly LlmStage[];
const LOGGABLE_BRANCHES = ['plain', 'respond'] as const satisfies readonly LlmBranch[];
const LOGGABLE_TURNS = ['welcome', 'turn'] as const;
const LOGGABLE_CHOICES = ['auto', 'forced', 'none'] as const satisfies readonly LlmChoice[];
const LOGGABLE_ANTHROPIC_TYPES: readonly string[] = [
  'invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error',
  'rate_limit_error', 'api_error', 'overloaded_error',
];

/**
 * The SDK's own provider-call error, or null. A retryable failure (429, 5xx,
 * transport) reaches us wrapped in the SDK's RetryError after its retries; the
 * wrapper's last attempt is the one unwrap. Only the SDK's own marker types are
 * accepted, so an impostor with the right field names is not read.
 */
function providerCallError(error: unknown): APICallError | null {
  try {
    const inner: unknown = RetryError.isInstance(error) ? error.lastError : error;
    return APICallError.isInstance(inner) ? inner : null;
  } catch {
    return null;
  }
}

/** The finite HTTP status of a provider rejection, or null. */
function statusOf(error: unknown): number | null {
  try {
    const call = providerCallError(error);
    if (!call) return null;
    const status: unknown = call.statusCode;
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  } catch {
    return null;
  }
}

/** The provider's own error type if (and only if) it is on the allowlist, as OUR constant. */
function anthropicTypeOf(error: unknown): string | null {
  try {
    const call = providerCallError(error);
    if (!call) return null;
    const data = call.data as { error?: { type?: unknown } } | undefined;
    const raw: unknown = data?.error?.type;
    if (typeof raw !== 'string') return null;
    const i = LOGGABLE_ANTHROPIC_TYPES.indexOf(raw);
    return i >= 0 ? LOGGABLE_ANTHROPIC_TYPES[i] : null;
  } catch {
    return null;
  }
}

/** The allowlist's own constant when `value` is on it, else the fallback. The input is never echoed. */
function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const i = typeof value === 'string' ? allowed.indexOf(value as T) : -1;
  return i >= 0 ? allowed[i] : fallback;
}

/** One closed log line. Exported for the tests; builds a fresh string, never keeps `error`. */
export function describeLlmFailure(error: unknown, ctx: LlmFailureContext): string {
  // Every context field is checked at run time, not only typed: a cast or a bug upstream must still
  // not put an arbitrary string on the line.
  const stage = pick(ctx.stage, LOGGABLE_STAGES, 'request');
  const branch = pick(ctx.branch, LOGGABLE_BRANCHES, 'respond');
  const turn = pick(ctx.turn, LOGGABLE_TURNS, 'turn');
  const choice = pick(ctx.choice, LOGGABLE_CHOICES, 'none');
  const provider = pick<AIProvider | 'unknown'>(ctx.provider, [...LOGGABLE_PROVIDERS, 'unknown'], 'unknown');
  const tools = Number.isInteger(ctx.tools) && ctx.tools >= 0 ? ctx.tools : 0;
  const status = stage === 'request' ? statusOf(error) : null;
  // The error.type vocabulary is Anthropic's; another provider's body may reuse a string by accident.
  const type = status !== null && provider === 'anthropic' ? anthropicTypeOf(error) : null;
  const klass = stage === 'config' ? 'config'
    // #2036: an auto turn whose reply carried no respond call is countable on its own, so the
    // rate the auto choice costs can be read off the log. A forced turn keeps the existing class.
    : stage === 'tool-output' ? (choice === 'auto' && ctx.noRespond === true ? 'auto-no-respond' : 'unexpected-tool-output')
    : status === null ? 'request-failed' : 'provider-status';
  return `[agent-chat] llm turn failed class=${klass} stage=${stage} branch=${branch} choice=${choice} turn=${turn} provider=${provider} status=${status ?? 'none'} type=${type ?? 'none'} tools=${tools}`;
}

/** Logging must never replace or escape the public error: the context is built inside the guard too. */
function logLlmFailure(error: unknown, context: () => LlmFailureContext): void {
  try {
    console.warn(describeLlmFailure(error, context()));
  } catch {
    // The diagnostic is best-effort.
  }
}

/**
 * Appended to the system text per turn, when the server selects auto, because
 * `auto` (unlike a forced choice) lets the model answer in text. Never stored.
 */
export const RESPOND_ONCE_INSTRUCTION =
  'Respond by calling the respond tool exactly once. Do not answer in free text.';

async function callAgentChatLlmUnsafe(args: {
  provider: AIProvider;
  apiKey: string;
  model: string;
  systemMessage: string;
  tools: HadronTool[] | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Inline config probe only: one bounded request and exactly one string-message respond call. */
  respondTest?: true;
  /** Server-owned per-chat or unsaved-pair decision; absent stays forced. */
  toolChoice?: ChatToolChoice | null;
}, trace: LlmTrace): Promise<AgentChatLlmResult> {
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
  const baseSystem = trimmedSystem.length > 0 ? trimmedSystem : undefined;

  // Find the respond tool. Hadron always ships a single tool per stage but
  // the array shape leaves room for more later.
  const respondTool = (args.tools ?? []).find((t) => t.name === 'respond');
  trace.stage = 'request';
  trace.branch = respondTool ? 'respond' : 'plain';
  const autoToolChoice = respondTool !== undefined && args.toolChoice === 'AUTO';
  const systemForSdk = autoToolChoice
    ? (baseSystem === undefined ? RESPOND_ONCE_INSTRUCTION : `${baseSystem}\n\n${RESPOND_ONCE_INSTRUCTION}`)
    : baseSystem;
  if (!respondTool && args.respondTest) throw new Error('Respond probe requires a tool');
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
    // #2032's inline probe is one bounded request, with no SDK retry spend.
    // The deadline is shared with the client's respond-test window (#2054):
    // the client outlasts it, so this abort is the one the user sees.
    ...(args.respondTest ? { maxRetries: 0, abortSignal: AbortSignal.timeout(AI_CONFIG_TEST_DEADLINE_MS) } : {}),
    // Force the LLM to call the respond tool on every turn. This is the
    // contract of the Chat API: one tool call per turn, no free-form text.
    // A server AUTO decision gets
    // `auto` plus the appended instruction; a reply with no respond call then
    // takes the same closed failure below as any other missing call.
    toolChoice: autoToolChoice ? 'auto' : { type: 'tool', toolName: 'respond' },
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
    trace.stage = 'tool-output';
    trace.noRespond = true;
    throw new Error(
      `LLM did not produce a respond() tool call. Got text: ${result.text?.slice(0, 200) ?? '(empty)'}`,
    );
  }

  const respondInput = firstCall.input as RespondCall;
  // Config testing has a stricter success criterion than existing chat parsing.
  // Keep normal turns' unvalidated first-call-wins behavior unchanged.
  if (args.respondTest && (toolCalls.length !== 1 || typeof respondInput?.message !== 'string')) {
    trace.stage = 'tool-output';
    throw new Error('Invalid respond probe output');
  }
  return {
    respond: respondInput,
    rawText: result.text ?? '',
    usage: {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    },
  };
}
