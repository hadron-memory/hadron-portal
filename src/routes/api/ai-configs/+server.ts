import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import {
  CREATE_AI_SERVICE_CONFIG_MUTATION,
  UPDATE_AI_SERVICE_CONFIG_MUTATION,
  DELETE_AI_SERVICE_CONFIG_MUTATION,
  TEST_AI_SERVICE_CONFIG_MUTATION,
  AI_PROVIDER_ENDPOINTS_QUERY,
} from '$lib/server/queries';
import { inlineTestable } from '$lib/components/ai-config-manager';
import { callAgentChatLlm } from '$lib/server/llm/agentChatLlm.js';
import { rateLimitResponse } from '$lib/server/rate-limit';
import type { AIProvider, AiConfigOwnerType, AiServiceConfig } from '$lib/types';
import type { AiConfigTestResult } from '$lib/ai-config-test';
import type { RequestHandler } from './$types';

/**
 * POST /api/ai-configs — generic CRUD + Test for the 036 AiServiceConfig
 * registry. One endpoint, dispatched on `action`, reused by the
 * AiServiceConfigManager component across the Org / Agent / App surfaces.
 *
 *   { action: 'create', ownerType, ownerId, name, provider, model, apiKey?, params?, enabled?,
 *       endpoint?, apiStyle? }
 *   { action: 'update', id, name?, provider?, model?, params?, enabled?,
 *       apiKeyAction: 'keep' | 'clear' | 'set', apiKey?, endpoint?, apiStyle? }
 *   { action: 'delete', id }
 *   { action: 'test', provider, model, apiKey }            // test an UNSAVED config inline
 *   { action: 'testSaved', id, override? }                 // #937: test a SAVED config by id
 *   { action: 'endpoints', provider }                      // server#1373: known endpoints
 *
 * endpoint / apiStyle follow the server's update grammar (server#1373): a key
 * that is ABSENT means unchanged, `null` means clear to the provider default,
 * a value sets it. So they're forwarded only when present, never defaulted.
 *
 * The browser never sees stored keys, so updates carry an explicit
 * `apiKeyAction` discriminator: 'keep' omits the apiKey arg (server keeps the
 * stored key), 'clear' sends "" (server clears), 'set' sends the new value.
 */

interface Body {
  action?: 'create' | 'update' | 'delete' | 'test' | 'testSaved' | 'endpoints';
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
  endpoint?: string | null;
  apiStyle?: 'CHAT_COMPLETIONS' | 'RESPONSES' | null;
  // testSaved (#937): values to test instead of the saved ones; never stored
  override?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string | null;
    apiStyle?: 'CHAT_COMPLETIONS' | 'RESPONSES' | null;
  };
}

/** Copy endpoint/apiStyle only when the caller sent them: absent means unchanged. */
function endpointArgs(src: { endpoint?: string | null; apiStyle?: string | null }): Record<string, string | null> {
  return {
    ...('endpoint' in src ? { endpoint: src.endpoint ?? null } : {}),
    ...('apiStyle' in src ? { apiStyle: src.apiStyle ?? null } : {}),
  };
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
            // A new config has nothing to clear: a null here is just "default".
            endpoint: body.endpoint || undefined,
            apiStyle: body.apiStyle || undefined,
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
            ...endpointArgs(body),
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

    case 'testSaved': {
      // #937 / server#1378: a SAVED config of ANY owner kind, by id, through
      // the server's own run path. The stored key never reaches the portal.
      // The server rate-limits and meters it too; this per-user bound is the
      // portal's own, as for the inline test (#467).
      const limited = rateLimitResponse(locals.user?.id ?? locals.token, 'ai-config-test', 20, 60_000);
      if (limited) return limited;
      if (!body.id) return json({ error: 'id is required' }, { status: 400 });
      const o = body.override ?? {};
      const override = {
        ...(o.provider ? { provider: o.provider } : {}),
        ...(o.model ? { model: o.model } : {}),
        ...(o.apiKey ? { apiKey: o.apiKey } : {}),
        ...endpointArgs(o),
      };
      try {
        const data = await client.request<{ testAiServiceConfig: AiConfigTestResult }>(TEST_AI_SERVICE_CONFIG_MUTATION, {
          id: body.id,
          override: Object.keys(override).length > 0 ? override : null,
        });
        return json({ result: data.testAiServiceConfig });
      } catch (e) {
        if (extractGqlErrorCode(e) === 'RATE_LIMITED') {
          return json({ error: 'Too many tests just now. Wait a minute and try again.' }, { status: 429 });
        }
        return json({ error: extractGqlError(e, 'The test could not run.') }, { status: 400 });
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
        // The portal's own client knows only built-in hosts (and its glm host
        // isn't the server's default), so for these it would test something
        // other than what a run does. The form doesn't offer it; refuse anyway.
        if (!inlineTestable({ provider, endpoint: body.endpoint ?? '', apiStyle: body.apiStyle ?? '' })) {
          return json(
            { error: 'Save this configuration first, then Test it: the server tests it with the endpoint a run uses.' },
            { status: 400 },
          );
        }
      } else {
        return json(
          { error: 'Provide provider, model and apiKey. To test a saved configuration, use testSaved with its id.' },
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

    case 'endpoints': {
      if (!body.provider) return json({ error: 'provider is required' }, { status: 400 });
      try {
        const data = await client.request<{ aiProviderEndpoints: unknown[] }>(AI_PROVIDER_ENDPOINTS_QUERY, {
          provider: body.provider,
        });
        return json({ endpoints: data.aiProviderEndpoints });
      } catch (e) {
        return json({ error: extractGqlError(e, 'Could not load the known endpoints.') }, { status: 400 });
      }
    }

    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
};
