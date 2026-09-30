import { gqlClient } from '$lib/server/api';
import {
  START_CHAT_MUTATION,
  SEND_CHAT_MESSAGE_MUTATION,
  PROCESS_CHAT_RESPONSE_MUTATION,
} from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import { publicChatError } from '$lib/server/llm/chatError.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import { rateLimitResponse } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

// #441: bound the fan-out. Each message becomes one sequential real LLM call,
// so an unbounded followUpMessages array holds a request open for N round-trips
// and grows unbounded in memory.
const MAX_FOLLOWUP_MESSAGES = 50;
const MAX_TOTAL_MESSAGE_BYTES = 100_000;

/**
 * POST /api/agent-chat/test-persona
 *
 * Backs the Tester's "Scripted persona (multi-turn)" section. Runs a
 * scripted conversation against the agent's chatbot with the agent's
 * configured LLM: a welcome turn, then one turn per scripted message,
 * until the script runs out or the bot ends the chat, including on the
 * welcome turn before any scripted message is sent.
 *
 * The report is built from startChat's result and what each turn
 * returns: the turns themselves, the stage transitions and conversation
 * handoffs they reported, the conversations visited (the conversation
 * startChat opened in, then each handoff), and pass/fail against
 * `expectedConversations`. It does not read the chat's stored route
 * history (nothing does) and does not return extracted data.
 * `personaName` is a label echoed into the report; it does not change
 * how the bot behaves.
 *
 * Body: { agentId, personaName, openingMessage, followUpMessages[],
 *         conversationName?, expectedConversations[] }
 *
 * Every turn is a real, billed LLM call. There is no free dry-run path:
 * the MCP persona tools went with the rest of `hadron_chatbot_*` in
 * hadron-server#1143 (#897).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const limited = rateLimitResponse(locals.user?.id ?? locals.token, 'agent-test-persona', 10, 60_000);
  if (limited) return limited;

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

  // #441: hard-cap the fan-out and total payload before issuing any LLM calls.
  const followUps = body.followUpMessages ?? [];
  if (followUps.length > MAX_FOLLOWUP_MESSAGES) {
    return new Response(
      JSON.stringify({ error: `followUpMessages exceeds the ${MAX_FOLLOWUP_MESSAGES}-message limit` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const totalBytes = [body.openingMessage, ...followUps].reduce(
    (n, m) => n + Buffer.byteLength(String(m ?? ''), 'utf8'),
    0,
  );
  if (totalBytes > MAX_TOTAL_MESSAGE_BYTES) {
    return new Response(
      JSON.stringify({ error: `total message size exceeds ${MAX_TOTAL_MESSAGE_BYTES} bytes` }),
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

    // 1. Start the chat. #898: this is a Tester path like test-run, so it
    // passes the same two flags. isTestRun=true skips the server's
    // AgentSubscription auto-provision (spec 019); without it, running a
    // scripted persona granted the tester a subscription to the agent.
    // scope is pinned rather than left to the server default so a test run
    // can never be shared to every AppMember.
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
      scope: 'private',
      isTestRun: true,
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
    let endedAtStep: number | null = welcomeTurn.chatEnded ? 0 : null;

    for (let i = 0; !welcomeTurn.chatEnded && i < allMessages.length; i++) {
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

      // Stop once the chatbot has ended the chat.
      if (turnResult.chatEnded) {
        endedAtStep = i + 1;
        break;
      }
    }

    const skippedMessages = allMessages.length - turns.filter((turn) => turn.role === 'user').length;

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

    // Pass/Fail scores the configured conversation expectations. Early
    // termination is reported separately through endedAtStep/skippedMessages;
    // it does not change this verdict by itself (#901).
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
        endedAtStep,
        skippedMessages,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const safe = publicChatError(e);
    return new Response(JSON.stringify({ error: safe.message, code: safe.code }), {
      status: safe.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
