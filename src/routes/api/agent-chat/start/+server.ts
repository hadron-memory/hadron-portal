import { gqlClient } from '$lib/server/api';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/start
 * Body: { agentId: string, conversationName?: string, scope?: 'private' | 'shared' }
 *
 * Spec 017: scope defaults to 'private' (FR-003). A 'shared' request requires
 * a resolvable App context server-side; if none, the server throws
 * SHARED_CHAT_REQUIRES_APP_CONTEXT which this handler surfaces to the portal
 * as a structured 400 body.
 *
 * Creates a new chat node in the matching memory (personal for private,
 * app-class for shared), then runs one "welcome" LLM turn so the agent
 * greets the user before they type anything. Returns the chatId, the
 * welcome message, and the initial conversation/stage so the UI can
 * render immediately.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { agentId?: string; conversationName?: string; scope?: 'private' | 'shared' };
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

  // Spec 017: scope defaults to 'private' per FR-003.
  const scope: 'private' | 'shared' = body.scope === 'shared' ? 'shared' : 'private';

  // Spec 016 — startChat and the welcome turn used to be coupled: a
  // failed welcome (missing AI config, agent with no conversations
  // configured, LLM error) would 500 the whole /start call AND leave
  // an orphan chat node in per-user memory. They are now separated:
  // startChat is the hard contract; the welcome turn is best-effort.
  // Reasoning: the chat exists once startChat returns a chatId — the
  // user can still type the first message themselves and chat begins
  // there. Welcome-turn failures surface as a soft `welcomeError`
  // hint, not a blocking error.

  // 1. Create the chat in Hadron — provisions the user memory and
  //    returns the compiled first-stage prompt + tool schema.
  let chatId: string;
  let systemMessage: string;
  let tools: HadronTool[] | null;
  let conversationName: string | null;
  let stageName: string | null;
  try {
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
      scope,
    });
    chatId = startResult.startChat.chatId;
    systemMessage = startResult.startChat.systemMessage;
    tools = startResult.startChat.tools;
    conversationName = startResult.startChat.conversationName;
    stageName = startResult.startChat.stageName;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start chat';
    // Spec 017 FR-006 / SC-005: when scope='shared' is rejected for no
    // qualifying AppMember context, surface a structured error body so the
    // portal can name the missing prerequisite to the user.
    if (msg.includes('SHARED_CHAT_REQUIRES_APP_CONTEXT') || msg.toLowerCase().includes('not a member of any app')) {
      return new Response(
        JSON.stringify({
          error: 'shared-chat-requires-app-context',
          message: msg,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Welcome turn — best-effort. The LLM gets the compiled stage
  //    prompt as the system message with no user history. On failure
  //    the chat is still created and usable; the user types the first
  //    message themselves.
  let welcomeMessage: string | null = null;
  let welcomeError: string | null = null;
  let finalStageName = stageName;
  let stageTransitioned = false;
  try {
    const turn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId,
      userMessage: null,
      startPayload: { systemMessage, tools },
    });
    welcomeMessage = turn.assistantMessage;
    finalStageName = turn.newStageName ?? stageName;
    stageTransitioned = turn.stageTransitioned;
  } catch (e) {
    welcomeError = e instanceof Error ? e.message : 'Welcome turn failed';
    console.warn('[agent-chat/start] welcome turn failed (chat is created and usable):', welcomeError);
  }

  return new Response(
    JSON.stringify({
      chatId,
      conversationName,
      stageName: finalStageName,
      welcomeMessage,
      welcomeError,
      stageTransitioned,
      scope,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
