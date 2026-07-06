import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  CREATE_AI_SERVICE_CONFIG_MUTATION,
  UPDATE_AI_SERVICE_CONFIG_MUTATION,
  DELETE_AI_SERVICE_CONFIG_MUTATION,
  RESOLVE_AI_CONFIG_QUERY,
} from '$lib/server/queries';
import { callAgentChatLlm } from '$lib/server/llm/agentChatLlm.js';
import { rateLimitResponse } from '$lib/server/rate-limit';
import type { AIProvider, AiConfigOwnerType, AiServiceConfig } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * POST /api/ai-configs — generic CRUD + Test for the 036 AiServiceConfig
 * registry. One endpoint, dispatched on `action`, reused by the
 * AiServiceConfigManager component across the Org / Agent / App surfaces.
 *
 *   { action: 'create', ownerType, ownerId, name, provider, model, apiKey?, params?, enabled? }
 *   { action: 'update', id, name?, provider?, model?, params?, enabled?,
 *       apiKeyAction: 'keep' | 'clear' | 'set', apiKey? }
 *   { action: 'delete', id }
 *   { action: 'test', provider, model, apiKey }            // test inline (before save)
 *   { action: 'test', name, appId?, agentId? }             // test a saved config
 *
 * The browser never sees stored keys, so updates carry an explicit
 * `apiKeyAction` discriminator: 'keep' omits the apiKey arg (server keeps the
 * stored key), 'clear' sends "" (server clears), 'set' sends the new value.
 */

interface Body {
  action?: 'create' | 'update' | 'delete' | 'test';
  // create / update
  id?: string;
  ownerType?: AiConfigOwnerType;
  ownerId?: string;
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeyAction?: 'keep' | 'clear' | 'set';
  params?: Record<string, unknown> | null;
  enabled?: boolean;
  // test (saved)
  appId?: string;
  agentId?: string;
}

const TEST_SYSTEM =
  'You are a test assistant. Reply with exactly one short sentence confirming you are reachable.';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const client = gqlClient(locals.token);

  switch (body.action) {
    case 'create': {
      const { ownerType, ownerId, name, provider, model } = body;
      if (!ownerType || !ownerId || !name || !provider || !model) {
        return json(
          { error: 'ownerType, ownerId, name, provider and model are required' },
          { status: 400 },
        );
      }
      try {
        const data = await client.request<{ createAiServiceConfig: AiServiceConfig }>(
          CREATE_AI_SERVICE_CONFIG_MUTATION,
          {
            ownerType,
            ownerId,
            name,
            provider,
            model,
            // Omitted apiKey ⇒ stored without a key. Only send a non-empty value.
            apiKey: body.apiKey ? body.apiKey : undefined,
            params: body.params ?? undefined,
            enabled: body.enabled ?? undefined,
          },
        );
        return json({ ok: true, config: data.createAiServiceConfig });
      } catch (e) {
        return json({ error: extractGqlError(e, 'Failed to create AI config') }, { status: 400 });
      }
    }

    case 'update': {
      if (!body.id) {
        return json({ error: 'id is required' }, { status: 400 });
      }
      // apiKeyAction maps to the server's keep/clear/replace semantics:
      //   keep  → omit apiKey      clear → ""      set → <value>
      let apiKey: string | undefined;
      if (body.apiKeyAction === 'clear') apiKey = '';
      else if (body.apiKeyAction === 'set') apiKey = body.apiKey ?? '';
      else apiKey = undefined; // 'keep' (default)
      try {
        const data = await client.request<{ updateAiServiceConfig: AiServiceConfig }>(
          UPDATE_AI_SERVICE_CONFIG_MUTATION,
          {
            id: body.id,
            name: body.name ?? undefined,
            provider: body.provider ?? undefined,
            model: body.model ?? undefined,
            apiKey,
            params: body.params ?? undefined,
            enabled: body.enabled ?? undefined,
          },
        );
        return json({ ok: true, config: data.updateAiServiceConfig });
      } catch (e) {
        return json({ error: extractGqlError(e, 'Failed to update AI config') }, { status: 400 });
      }
    }

    case 'delete': {
      if (!body.id) {
        return json({ error: 'id is required' }, { status: 400 });
      }
      try {
        await client.request(DELETE_AI_SERVICE_CONFIG_MUTATION, { id: body.id });
        return json({ ok: true });
      } catch (e) {
        return json({ error: extractGqlError(e, 'Failed to delete AI config') }, { status: 400 });
      }
    }

    case 'test': {
      // #467: this drives a real LLM call — and the saved-config path burns the
      // org's server-stored provider budget — so bound it per user like the
      // other tester endpoints (#441). Without it a co-tenant could loop this to
      // drain budget / occupy the adapter process.
      const limited = rateLimitResponse(locals.user?.id ?? locals.token, 'ai-config-test', 20, 60_000);
      if (limited) return limited;

      let provider: string;
      let model: string;
      let apiKey: string;

      if (body.provider && body.model && body.apiKey) {
        // Test-before-save: the form values (incl. a freshly-entered key, or the
        // bedrock JSON triple) are passed inline.
        provider = body.provider;
        model = body.model;
        apiKey = body.apiKey;
      } else if (body.name && (body.appId || body.agentId)) {
        // Test a saved config: resolve the decrypted key server-side. Only
        // possible where there's an app/agent execution context.
        try {
          const resolved = await client.request<{
            resolveAIConfig: { provider: string; model: string; apiKey: string } | null;
          }>(RESOLVE_AI_CONFIG_QUERY, {
            name: body.name,
            appId: body.appId ?? undefined,
            agentId: body.agentId ?? undefined,
          });
          if (!resolved.resolveAIConfig) {
            return json({ ok: false, error: 'No AI config available to test' });
          }
          provider = body.provider || resolved.resolveAIConfig.provider;
          model = body.model || resolved.resolveAIConfig.model;
          apiKey = resolved.resolveAIConfig.apiKey;
        } catch (e) {
          return json({ ok: false, error: extractGqlError(e, 'Failed to resolve AI config') });
        }
      } else {
        return json(
          { error: 'Provide provider/model/apiKey, or name plus appId/agentId' },
          { status: 400 },
        );
      }

      try {
        const llmResult = await callAgentChatLlm({
          provider: provider as AIProvider,
          apiKey,
          model,
          systemMessage: TEST_SYSTEM,
          tools: null,
          messages: [{ role: 'user', content: 'Are you there?' }],
        });
        return json({
          ok: true,
          provider,
          model,
          reply: llmResult.respond.message ?? llmResult.rawText,
          usage: llmResult.usage,
        });
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'LLM call failed' });
      }
    }

    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
};
