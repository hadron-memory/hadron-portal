import { gqlClient } from '$lib/server/api';
import {
  UPDATE_AGENT_AI_CONFIG_MUTATION,
  CLEAR_AGENT_AI_CONFIG_MUTATION,
  AGENT_AI_CONFIG_QUERY,
} from '$lib/server/queries';
import { callAgentChatLlm } from '$lib/server/llm/agentChatLlm.js';
import type { AIProvider } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/ai-config
 *
 * Body (action: 'save'):   { agentId, provider, model, apiKey? }
 *   apiKey is optional when a key already exists (update provider/model only).
 * Body (action: 'clear'):  { agentId }
 * Body (action: 'test'):   { agentId, provider?, model?, apiKey? }
 *   When provider/model/apiKey are given inline, test uses those values
 *   directly instead of fetching the saved config. This lets the user test
 *   before saving.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: { action?: string; agentId?: string; provider?: string; model?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.agentId) {
    return new Response(JSON.stringify({ error: 'agentId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const client = gqlClient(locals.token);

  try {
    if (body.action === 'save') {
      if (!body.provider || !body.model) {
        return new Response(
          JSON.stringify({ error: 'provider and model are required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      await client.request(UPDATE_AGENT_AI_CONFIG_MUTATION, {
        agentId: body.agentId,
        provider: body.provider,
        model: body.model,
        apiKey: body.apiKey || null,  // null = keep existing key
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'clear') {
      await client.request(CLEAR_AGENT_AI_CONFIG_MUTATION, { agentId: body.agentId });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'test') {
      // If the caller provides provider/model/apiKey inline, test with
      // those values directly (enables "test before save"). Otherwise
      // fall back to the saved config.
      let provider: string;
      let apiKey: string;
      let model: string;

      if (body.provider && body.model && body.apiKey) {
        provider = body.provider;
        model = body.model;
        apiKey = body.apiKey;
      } else {
        const result = await client.request<{
          agentAIConfig: { provider: string; apiKey: string; model: string } | null;
        }>(AGENT_AI_CONFIG_QUERY, { agentId: body.agentId });
        if (!result.agentAIConfig) {
          return new Response(
            JSON.stringify({ ok: false, error: 'No AI config saved yet' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // If the caller overrode provider/model in the form but didn't
        // enter a new key, merge form values with the saved key.
        provider = body.provider || result.agentAIConfig.provider;
        model = body.model || result.agentAIConfig.model;
        apiKey = body.apiKey || result.agentAIConfig.apiKey;
      }

      try {
        const llmResult = await callAgentChatLlm({
          provider: provider as AIProvider,
          apiKey,
          model,
          systemMessage: 'You are a test assistant. Reply with exactly one short sentence confirming you are reachable.',
          tools: null,
          messages: [{ role: 'user', content: 'Are you there?' }],
        });
        return new Response(
          JSON.stringify({
            ok: true,
            model,
            provider,
            reply: llmResult.respond.message ?? llmResult.rawText,
            usage: llmResult.usage,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : 'LLM call failed',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
