import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import {
  CREATE_AI_SERVICE_CONFIG_MUTATION,
  UPDATE_AI_SERVICE_CONFIG_MUTATION,
  DELETE_AI_SERVICE_CONFIG_MUTATION,
  TEST_AI_SERVICE_CONFIG_MUTATION,
  AI_PROVIDER_ENDPOINTS_QUERY,
  AI_SERVICE_CONFIGS_QUERY,
  RESOLVE_AI_SERVICE_CONFIGS_QUERY,
} from '$lib/server/queries';
import { fetchAllItems } from '$lib/server/paginate';
import { inlineTestable } from '$lib/components/ai-config-manager';
import { callAgentChatLlm } from '$lib/server/llm/agentChatLlm.js';
import { chatToolChoiceFor } from '$lib/server/llm/chatToolChoice.js';
import { RESPOND_TEST_TOOLS } from '$lib/server/llm/respondTestTool';
import { publicChatError } from '$lib/server/llm/chatError.js';
import { t } from '$lib/i18n/t';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
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
    apiKey?: string | null;
    endpoint?: string | null;
    apiStyle?: 'CHAT_COMPLETIONS' | 'RESPONSES' | null;
    // hadron-server#1413: edited params to test; null = cleared. Absent = saved.
    params?: Record<string, unknown> | null;
  };
}

/** Copy endpoint/apiStyle only when the caller sent them: absent means unchanged. */
function endpointArgs(src: { endpoint?: string | null; apiStyle?: string | null }): Record<string, string | null> {
  return {
    ...('endpoint' in src ? { endpoint: src.endpoint ?? null } : {}),
    ...('apiStyle' in src ? { apiStyle: src.apiStyle ?? null } : {}),
  };
}

// Only definitive auth codes are safe to retry as draft-local refusals.
// Never echo GraphQL text: it can contain provider credentials.
function authRefusal(error: unknown): Response | null {
  const code = extractGqlErrorCode(error);
  if (code === 'FORBIDDEN') return json({ error: t('ai-config.error.forbidden', 'Forbidden') }, { status: 403 });
  if (code === 'UNAUTHENTICATED') return json({ error: t('ai-config.error.unauthorized', 'Unauthorized') }, { status: 401 });
  return null;
}

const TEST_SYSTEM =
  'You are a test assistant. Call respond exactly once with one short sentence confirming you are reachable, onTrack true, empty data and next_stage null.';

const READBACK_TIMEOUT_MS = 10_000;

function readbackClient(token: string, parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('AI configuration readback timed out')), READBACK_TIMEOUT_MS);
  return {
    client: gqlClient(token, controller.signal),
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
    },
  };
}

// A committed write re-reads only this section, never invalidateAll(): Kit
// renders a failed __data.json over the whole page before a component catch
// can report the committed outcome. The query, owner arguments and token are
// the same masked, paginated read the page loaders use. A refused upstream
// read is an in-page `{failed:true}` result, not an HTTP 5xx. Browser aborts
// and a server deadline cancel the upstream GraphQL fetch as well.
export const GET: RequestHandler = async ({ locals, url, request }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401, headers });

  const readback = readbackClient(locals.token, request.signal);
  try {
    const ownerType = url.searchParams.get('ownerType');
    const ownerId = url.searchParams.get('ownerId');
    const appRef = url.searchParams.get('appRef');
    const agentRef = url.searchParams.get('agentRef');

    // App chat consumes the resolution walk, not just the App-owned rows. This
    // mode refreshes that existing loader slice after an AI-config write without
    // invalidating the rest of the App page. It uses the same App-membership gate.
    if (appRef !== null || agentRef !== null) {
      if (!appRef || !agentRef || ownerType !== null || ownerId !== null) {
        return json({ error: 'appRef and agentRef are required together, without owner arguments' }, { status: 400, headers });
      }
      try {
        const data = await readback.client.request<{ resolveAiServiceConfigs: AiServiceConfig[] }>(
          RESOLVE_AI_SERVICE_CONFIGS_QUERY,
          { appRef, agentRef },
        );
        return json({ configs: data.resolveAiServiceConfigs }, { headers });
      } catch (e) {
        // An org admin may manage the App's configs without being an App member.
        // Their Chat picker is legitimately withheld, not a failed refresh that
        // should lock further writes. Every other refusal remains a real failure.
        if (extractGqlErrorCode(e) === 'FORBIDDEN') {
          return json({ withheld: true }, { headers });
        }
        console.error('[api/ai-configs] resolved section readback failed:', e);
        return json({ failed: true }, { headers });
      }
    }

    if (
      !ownerId ||
      (ownerType !== 'HADRON_SERVER' && ownerType !== 'ORGANIZATION' && ownerType !== 'APP' && ownerType !== 'AGENT')
    ) {
      return json({ error: 'Valid ownerType and ownerId are required' }, { status: 400, headers });
    }

    try {
      const configs = await fetchAllItems<AiServiceConfig>(
        readback.client,
        AI_SERVICE_CONFIGS_QUERY,
        'aiServiceConfigs',
        { ownerType, ownerId },
      );
      return json({ configs }, { headers });
    } catch (e) {
      console.error('[api/ai-configs] section readback failed:', e);
      return json({ failed: true }, { headers });
    }
  } finally {
    readback.done();
  }
};

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
        const refusal = authRefusal(e);
        if (refusal) return refusal;
        const code = extractGqlErrorCode(e);
        if (code === 'DuplicateAiServiceConfigNameError') {
          return json({ error: t('ai-config.error.duplicate-name', 'An AI configuration with this name already exists for this owner.') }, { status: 409 });
        }
        if (code === 'AiConfigValidationError') {
          return json({ error: t('ai-config.error.invalid', 'AI configuration is invalid. Check the name, provider settings, model, and API key.') }, { status: 400 });
        }
        return json({ error: t('ai-config.error.create-failed', 'Failed to create AI configuration.') }, { status: 500 });
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
            // Same grammar as endpoint: ABSENT = unchanged, null = clear, a value
            // REPLACES the stored params (server updateAiServiceConfig). The form
            // sends the whole params it shows, so its null must reach the server:
            // collapsing it to "absent" kept stale params, e.g. a hidden
            // openai-compatible toolCalling surviving a switch to GLM (Chip, #951).
            ...('params' in body ? { params: body.params ?? null } : {}),
            enabled: body.enabled ?? undefined,
            ...endpointArgs(body),
          },
        );
        return json({ ok: true, config: data.updateAiServiceConfig });
      } catch (e) {
        const refusal = authRefusal(e);
        if (refusal) return refusal;
        const code = extractGqlErrorCode(e);
        if (code === 'DuplicateAiServiceConfigNameError') {
          return json({ error: t('ai-config.error.duplicate-name', 'An AI configuration with this name already exists for this owner.') }, { status: 409 });
        }
        if (code === 'AiConfigValidationError') {
          return json({ error: t('ai-config.error.invalid', 'AI configuration is invalid. Check the name, provider settings, model, and API key.') }, { status: 400 });
        }
        return json({ error: t('ai-config.error.update-failed', 'Failed to update AI configuration.') }, { status: 500 });
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
        const refusal = authRefusal(e);
        if (refusal) return refusal;
        return json({ error: t('ai-config.error.delete-failed', 'Failed to delete AI configuration.') }, { status: 500 });
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
        // An explicit null is "test without the stored key" (Remove the stored
        // key ticked), not "unchanged": pass it through rather than drop it.
        ...(o.apiKey === null ? { apiKey: null } : {}),
        // Absent keeps the saved params; null is a real edit (cleared), so it
        // passes through like the key's null.
        ...('params' in o ? { params: o.params ?? null } : {}),
      };
      try {
        const data = await client.request<{ testAiServiceConfig: AiConfigTestResult }>(TEST_AI_SERVICE_CONFIG_MUTATION, {
          id: body.id,
          override: Object.keys(override).length > 0 ? override : null,
        });
        const result = data.testAiServiceConfig;
        // The server's structured failure may still contain raw provider text
        // on an older deployment. Keep only a known code and fixed message.
        const code = result.error?.code;
        const safeCode = code === 'NO_API_KEY' || code === 'KEY_UNREADABLE' || code === 'QUOTA_EXCEEDED' || code === 'CONFIG_INVALID' || code === 'LLM_CALL_FAILED'
          ? code : 'TEST_FAILED';
        return json({ result: result.error ? {
          ...result,
          error: { code: safeCode, message: t('ai-config.error.test-failed', 'The test could not run.'), transient: result.error.transient === true },
        } : result });
      } catch (e) {
        if (extractGqlErrorCode(e) === 'RATE_LIMITED') {
          return json({ error: 'Too many tests just now. Wait a minute and try again.' }, { status: 429 });
        }
        return json({ error: t('ai-config.error.test-failed', 'The test could not run.') }, { status: 500 });
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
          // The component's own string, so the two can't drift (#951 Codex P2).
          return json({ error: aiConfigStrings.testSaveFirst() }, { status: 400 });
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
          tools: RESPOND_TEST_TOOLS,
          respondTest: true,
          toolChoice: await chatToolChoiceFor(client, provider, model),
          messages: [{ role: 'user', content: 'Are you there?' }],
        });
        return json({
          ok: true,
          provider,
          model,
          reply: llmResult.respond.message,
          usage: llmResult.usage,
        });
      } catch (e) {
        const safe = publicChatError(e);
        return json({ ok: false, error: safe.message, code: safe.code });
      }
    }

    case 'endpoints': {
      if (!body.provider) return json({ error: 'provider is required' }, { status: 400 });
      try {
        const data = await client.request<{ aiProviderEndpoints: unknown[] }>(AI_PROVIDER_ENDPOINTS_QUERY, {
          provider: body.provider,
        });
        return json({ endpoints: data.aiProviderEndpoints });
      } catch {
        // #967: never echo the server's error text from this route.
        return json({ error: t('ai-config.error.endpoints-failed', 'Could not load the known endpoints.') }, { status: 400 });
      }
    }

    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
};
