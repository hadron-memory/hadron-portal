import { gqlClient } from '$lib/server/api';
import { RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';
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
export async function fetchAgentAIConfig(
  token: string | null,
  agentId: string,
  opts?: { appId?: string | null; configName?: string | null },
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
    }>(RESOLVE_AI_CONFIG_QUERY, {
      name: opts?.configName ?? 'default',
      appRef: opts?.appId ?? undefined,
      agentRef: agentId,
    });
    resolved = result.resolveAIConfig;
  } catch (e) {
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
  opts?: { appId?: string | null; configName?: string | null },
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
