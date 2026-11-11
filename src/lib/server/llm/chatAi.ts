import { gqlClient } from '$lib/server/api';
import { CHAT_AI_CONFIG_CHOICES_QUERY, RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';
import { DEFAULT_CHAT_AI_CHOICE } from '$lib/chat-ai-choice';
import { isMissingEffectiveEndpoint, portalRuntimeRefusal } from './agentChatLlm.js';
import type { AIProvider } from '$lib/types';
import { CHAT_ERROR, ChatError } from './chatError.js';

export type ChatAi = { provider: AIProvider; apiKey: string; model: string };

/**
 * portal#1611: what resolving the chat's AI configuration came to. Never
 * throws: a chat starts whether or not a model resolves (hadron-server#3096
 * leaves `llmModel` optional), and the failure is kept so the turn that would
 * have used the config fails exactly as it always did.
 */
export type ChatAiResolution = { ok: true; ai: ChatAi } | { ok: false; error: unknown };

export const CREDENTIAL_UNAVAILABLE = CHAT_ERROR.credentialUnavailable;

/** A resolved identity is not evidence that this runtime received credentials. */
export function hasRuntimeCredential(apiKey: unknown): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

/** Fetch a config usable by this runtime. Never substitute another credential. */
/**
 * What a chat resolves its AI config from. `configName` is honoured only without an App (the Tester and
 * fixture runs, which have no choice list). In an App, the portal never trusts a client-sent name
 * (portal#1963): it resolves from the validated choice, or from the chat itself.
 */
export type ChatAiTarget = {
  appId?: string | null;
  configName?: string | null;
  /** The choice this request makes (`default` or a config id), already shape-checked. */
  aiConfigChoice?: string | null;
  /** The chat this turn belongs to; absent for a chat not started yet. */
  chatId?: string | null;
};

type ResolveVariables = { name?: string; appRef?: string; agentRef: string; chatId?: string };

/** One row of chatAiConfigChoices, as far as resolution needs it. */
type ChoiceRow = { value: string; name: string; isDefault: boolean; isAppChatbotConfig: boolean };

async function appChoices(token: string | null, appId: string): Promise<ChoiceRow[]> {
  const r = await gqlClient(token).request<{ chatAiConfigChoices: ChoiceRow[] }>(CHAT_AI_CONFIG_CHOICES_QUERY, { appRef: appId });
  return r.chatAiConfigChoices;
}

/**
 * portal#1963: the resolveAIConfig variables for a chat in an App, mirroring the server's order
 * (hrn:node:hadronmemory.com:specs:cor:dmo:050:10): this request's choice, else the chat's stored choice, else the App's chatbot config,
 * else the `default` walk.
 * - A config id is resolved by the name the server lists for it NOW, so a rename after page load can't run
 *   a stale name. Among same-named configs the App's own is the innermost owner, so the name walk lands on
 *   that very config. An id the list doesn't have is refused as unavailable, before anything runs.
 * - `default` is the walk by name `default`. An App config NAMED `default` is the walk's first step, so it is
 *   what both the marker and its own id resolve to, by the server's contract.
 * - With no choice, an existing chat resolves by its id, so the server applies its stored choice.
 * - With no choice and no chat yet, the App's chatbot config, else `default`, as listed by the server.
 */
export async function chatResolveVariables(
  token: string | null,
  agentId: string,
  target: ChatAiTarget & { appId: string },
): Promise<ResolveVariables> {
  const base = { appRef: target.appId, agentRef: agentId };
  const choice = target.aiConfigChoice ?? null;
  if (choice === DEFAULT_CHAT_AI_CHOICE) return { ...base, name: DEFAULT_CHAT_AI_CHOICE };
  if (choice !== null) {
    const row = (await appChoices(token, target.appId)).find((c) => !c.isDefault && c.value === choice);
    if (!row) throw new ChatError('configChoiceUnavailable');
    return { ...base, name: row.name };
  }
  if (target.chatId) return { ...base, chatId: target.chatId };
  const chatbot = (await appChoices(token, target.appId)).find((c) => !c.isDefault && c.isAppChatbotConfig);
  return { ...base, name: chatbot?.name ?? DEFAULT_CHAT_AI_CHOICE };
}

export async function fetchAgentAIConfig(
  token: string | null,
  agentId: string,
  opts?: ChatAiTarget,
): Promise<ChatAi> {
  // 036-ai-service-config: resolve a named config (default `default`) for the
  // chat's context. Passing `appId` makes the walk App → Agent → Org → Host
  // (so app-level configs apply); agentId-only stays Agent → Org → Host.
  // `configName` lets the App chat pick a specific config. Returns the
  // credential only when the server permits it. Identity-only resolution is
  // refused below. `resolveAIConfig` throws NoAiConfigAvailableError when
  // nothing resolves — translate that into the "configure a provider"
  // guidance, but let auth/transport errors propagate untouched.
  let resolved: { provider: string; apiKey: string | null; model: string; effectiveEndpoint: string | null };
  try {
    const result = await gqlClient(token).request<{
      resolveAIConfig: { provider: string; apiKey: string | null; model: string; effectiveEndpoint: string | null };
    }>(
      RESOLVE_AI_CONFIG_QUERY,
      opts?.appId
        ? await chatResolveVariables(token, agentId, { ...opts, appId: opts.appId })
        : { name: opts?.configName ?? DEFAULT_CHAT_AI_CHOICE, agentRef: agentId },
    );
    resolved = result.resolveAIConfig;
  } catch (e) {
    if (e instanceof ChatError) throw e;
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('NoAiConfigAvailable') || /no ai config|not configured/i.test(msg)) {
      throw new ChatError('noConfig');
    }
    // A server without #1373 can't say where a config goes, so nothing is run.
    if (isMissingEffectiveEndpoint(msg)) throw new ChatError('oldServer');
    throw e;
  }
  // Stopgap (Holger, 2026-09-27): never run a config somewhere other than where
  // it's meant to go, with its key. Refused BEFORE the key is handed to anything.
  const refusal = portalRuntimeRefusal(resolved);
  if (refusal) throw new ChatError('configUnsupported');
  if (!hasRuntimeCredential(resolved.apiKey)) throw new ChatError('credentialUnavailable');
  return {
    provider: resolved.provider as AIProvider,
    apiKey: resolved.apiKey,
    model: resolved.model,
  };
}

/** Resolve once, before startChat. Never throws (see ChatAiResolution). */
export async function resolveChatAi(
  token: string | null,
  agentId: string,
  opts?: ChatAiTarget,
): Promise<ChatAiResolution> {
  try {
    return { ok: true, ai: await fetchAgentAIConfig(token, agentId, opts) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * The `llmModel` GraphQL variable for startChat / sendChatMessage, as a
 * spread: the key is PRESENT only when a model actually resolved. The value is
 * the resolved model, raw — the server validates (256 UTF-16 code units, no
 * control or format characters) and the portal never trims, rewrites or drops
 * a known model. An unresolved or refused config, or an empty model, omits the
 * key: never null, never "", never a guess, and never the key or endpoint.
 */
export function llmModelVariable(resolution: ChatAiResolution | null | undefined): { llmModel?: string } {
  return resolution?.ok && typeof resolution.ai.model === 'string' && resolution.ai.model !== ''
    ? { llmModel: resolution.ai.model }
    : {};
}

