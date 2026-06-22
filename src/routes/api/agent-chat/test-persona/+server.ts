import { gqlClient } from '$lib/server/api';
import {
  START_CHAT_MUTATION,
  SEND_CHAT_MESSAGE_MUTATION,
  PROCESS_CHAT_RESPONSE_MUTATION,
} from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/test-persona
 *
 * "Live test" mode: runs a test persona through the chatbot using the
 * agent's configured LLM. Executes all turns automatically and returns
 * a test report with route history, extracted data, and pass/fail.
 *
 * Body: { agentId, personaName, openingMessage, followUpMessages[],
 *         conversationName?, expectedConversations[] }
 *
 * This is the "costs money" version. For free dry-run testing, use
 * hadron_chat_run_persona in Claude Code.
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
    personaName?: string;
    openingMessage?: string;
    followUpMessages?: string[];
    conversationName?: string;
    expectedConversations?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.agentId || !body.personaName || !body.openingMessage) {
    return new Response(
      JSON.stringify({ error: 'agentId, personaName, and openingMessage are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const client = gqlClient(locals.token);
    const turns: Array<{
      step: number;
      role: 'user' | 'assistant';
      message: string;
      stageTransitioned?: boolean;
      newStageName?: string | null;
      conversationHandoff?: string | null;
      onTrack?: boolean;
    }> = [];

    // 1. Start the chat
    const startResult = await client.request<{
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

    const { chatId } = startResult.startChat;

    // 2. Run the welcome turn (agent greets the persona)
    const welcomeTurn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId,
      userMessage: null,
      startPayload: {
        systemMessage: startResult.startChat.systemMessage,
        tools: startResult.startChat.tools,
      },
    });

    turns.push({
      step: 0,
      role: 'assistant',
      message: welcomeTurn.assistantMessage,
      stageTransitioned: welcomeTurn.stageTransitioned,
      newStageName: welcomeTurn.newStageName,
      conversationHandoff: welcomeTurn.conversationHandoff,
      onTrack: welcomeTurn.onTrack,
    });

    // 3. Send the opening message
    const allMessages = [body.openingMessage, ...(body.followUpMessages ?? [])];

    for (let i = 0; i < allMessages.length; i++) {
      const userMessage = allMessages[i];
      turns.push({ step: i + 1, role: 'user', message: userMessage });

      const turnResult = await runChatTurn({
        token: locals.token,
        agentId: body.agentId,
        chatId,
        userMessage,
      });

      turns.push({
        step: i + 1,
        role: 'assistant',
        message: turnResult.assistantMessage,
        stageTransitioned: turnResult.stageTransitioned,
        newStageName: turnResult.newStageName,
        conversationHandoff: turnResult.conversationHandoff,
        onTrack: turnResult.onTrack,
      });

      // Stop if the chatbot indicates it's done or off-track
      if (turnResult.chatEnded) break;
    }

    // 4. Build the test report
    const stageTransitions = turns
      .filter((t) => t.stageTransitioned)
      .map((t) => ({ step: t.step, newStage: t.newStageName, conversationHandoff: t.conversationHandoff }));

    const conversationsVisited = [...new Set(
      stageTransitions
        .filter((t) => t.conversationHandoff)
        .map((t) => t.conversationHandoff!),
    )];
    if (startResult.startChat.conversationName) {
      conversationsVisited.unshift(startResult.startChat.conversationName);
    }

    let pass = true;
    const issues: string[] = [];
    if (body.expectedConversations?.length) {
      for (const exp of body.expectedConversations) {
        if (!conversationsVisited.includes(exp)) {
          pass = false;
          issues.push(`Expected conversation "${exp}" was not visited.`);
        }
      }
    }

    const offTrackTurns = turns.filter((t) => t.onTrack === false);
    if (offTrackTurns.length > 0) {
      issues.push(`${offTrackTurns.length} turn(s) were off-track.`);
    }

    return new Response(
      JSON.stringify({
        chatId,
        personaName: body.personaName,
        pass,
        issues,
        turns,
        stageTransitions,
        conversationsVisited,
        totalTurns: turns.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Test persona failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
