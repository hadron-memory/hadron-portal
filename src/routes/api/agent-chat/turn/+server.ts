import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/turn
 * Body: { agentId: string, chatId: string, userMessage: string }
 *
 * Runs one full chat turn: sendChatMessage → LLM call → processChatResponse.
 * Returns the assistant's message plus stage transition info.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    agentId?: string;
    chatId?: string;
    userMessage?: string;
    appId?: string;
    configName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.agentId || !body.chatId || !body.userMessage) {
    return new Response(
      JSON.stringify({ error: 'agentId, chatId, and userMessage are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const turn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId: body.chatId,
      userMessage: body.userMessage,
      appId: body.appId,
      configName: body.configName,
    });
    return new Response(JSON.stringify(turn), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Turn failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
