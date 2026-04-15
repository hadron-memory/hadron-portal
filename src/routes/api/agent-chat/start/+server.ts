import { gqlClient } from '$lib/server/api';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/start
 * Body: { agentId: string, conversationName?: string }
 *
 * Creates a new chat node in the user's personal memory for the agent,
 * then runs one "welcome" LLM turn so the agent greets the user before
 * they type anything. Returns the chatId, the welcome message, and the
 * initial conversation/stage so the UI can render immediately.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { agentId?: string; conversationName?: string };
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

  try {
    // 1. Create the chat in Hadron — provisions the user memory and
    //    returns the compiled first-stage prompt + tool schema.
    const startResult = await gqlClient(locals.token).request<{
      startChat: {
        chatId: string;
        systemMessage: string;
        tools: HadronTool[] | null;
        conversationName: string | null;
        stageName: string | null;
      };
    }>(START_CHAT_MUTATION, {
      agentId: body.agentId,
      conversationName: body.conversationName ?? null,
    });

    const { chatId, systemMessage, tools, conversationName, stageName } = startResult.startChat;

    // 2. Run the welcome turn. The LLM gets the compiled stage prompt as
    //    the system message with no user history — it responds via the
    //    respond() tool and we save the welcome message via
    //    processChatResponse. The frontend gets the welcome immediately.
    const turn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId,
      userMessage: null,
      startPayload: { systemMessage, tools },
    });

    return new Response(
      JSON.stringify({
        chatId,
        conversationName,
        stageName: turn.newStageName ?? stageName,
        welcomeMessage: turn.assistantMessage,
        stageTransitioned: turn.stageTransitioned,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start chat';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
