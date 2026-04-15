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
 * Body (action: 'save'):   { agentId, provider, model, apiKey }
 * Body (action: 'clear'):  { agentId }
 * Body (action: 'test'):   { agentId }
 *
 * The 'test' action fetches the decrypted config via GraphQL and makes a
 * tiny "hello" completion to verify the key works, then returns a
 * success/failure message to the frontend.
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
      if (!body.provider || !body.model || !body.apiKey) {
        return new Response(
          JSON.stringify({ error: 'provider, model, and apiKey are required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      await client.request(UPDATE_AGENT_AI_CONFIG_MUTATION, {
        agentId: body.agentId,
        provider: body.provider,
        model: body.model,
        apiKey: body.apiKey,
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
      // Round-trip a tiny "hello" via the configured provider. The user
      // sees "✓ Works" or the provider's error message.
      const result = await client.request<{
        agentAIConfig: { provider: string; apiKey: string; model: string } | null;
      }>(AGENT_AI_CONFIG_QUERY, { agentId: body.agentId });
      if (!result.agentAIConfig) {
        return new Response(
          JSON.stringify({ ok: false, error: 'No AI config saved yet' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const { provider, apiKey, model } = result.agentAIConfig;
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
