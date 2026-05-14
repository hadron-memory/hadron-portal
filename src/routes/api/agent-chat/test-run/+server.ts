import { gqlClient } from '$lib/server/api';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import { judgeAgentReply, judgeVerdict } from '$lib/server/agent-tester/llm-judge';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/test-run
 *
 * Spec 019 — Agent Chat Tester. Runs a single test message against an
 * agent's chatbot and returns the reply plus a structured route trace.
 * In US2, the endpoint also evaluates an optional assertion in one of
 * three modes: literal-contains, regex, or llm-judge. Production-state
 * isolation (FR-015 / SC-005) is preserved by NOT calling
 * SAVE_CHAT_SUMMARY_MUTATION or any training/feedback path.
 *
 * Body: { agentId, message, persona?, resetSession?, assertion? }
 */

type Assertion =
  | { mode: 'literal-contains'; value: string }
  | { mode: 'regex'; pattern: string; flags?: string }
  | { mode: 'llm-judge'; criterion: string; threshold: number };

interface TestRunBody {
  agentId?: string;
  message?: string;
  persona?: string | null;
  resetSession?: boolean;
  assertion?: Assertion | null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: TestRunBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.agentId || !body.message) {
    return json({ error: 'agentId and message are required' }, 400);
  }

  // Validate assertion shape up-front so the user gets a 400 (not a
  // 500) on malformed input.
  if (body.assertion) {
    const validationError = validateAssertion(body.assertion);
    if (validationError) return json({ error: validationError }, 400);
  }

  try {
    const client = gqlClient(locals.token);

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
      conversationName: null,
    });

    const { chatId, conversationName, stageName } = startResult.startChat;

    // Welcome turn: the bot's reply itself is discarded (the Tester
    // probes user-driven behaviour), but any stage / conversation
    // transition the welcome triggers MUST flow forward — otherwise
    // routeTrace lies about where the user message actually landed.
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

    const turn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId,
      userMessage: body.message,
    });

    // Resolve conversation + stage with welcome-turn results as the
    // fallback so a transition triggered by the welcome is preserved.
    const finalConversation =
      turn.conversationHandoff ?? welcomeTurn.conversationHandoff ?? conversationName ?? null;
    const finalStage =
      turn.newStageName ?? welcomeTurn.newStageName ?? stageName ?? null;

    // NOTE: `personaName` is **metadata-only** in US1 single-message
    // mode. The chat-platform's `runChatTurn` does not accept a
    // per-turn persona override — personas are driven by
    // `h-chat-run-persona` (the scripted-persona path, US4) and by
    // server-side state machinery, not by a single-turn HTTP call.
    // We surface the user's input here so the UI can show what they
    // asked for, but the bot's actual routing is its default. To
    // probe persona-specific behaviour, use the Scripted persona
    // section (US4) which delegates to /api/agent-chat/test-persona.
    // `routeCandidates` is intentionally empty in US1; the chat
    // platform does not yet expose rejected-route metadata on a
    // single-turn request.
    const routeTrace = {
      conversationLoc: finalConversation,
      stageLoc: finalStage,
      personaName: body.persona ?? null,
      routeCandidates: [] as Array<{ conversationLoc: string; rejected: boolean; reason?: string }>,
      onTrack: turn.onTrack,
      offTrackReason: turn.offTrackReason,
    };

    let assertion: AssertionResult | null = null;
    if (body.assertion) {
      assertion = await evaluateAssertion(
        body.assertion,
        turn.assistantMessage,
        locals.token,
        body.agentId,
      );
    }

    return json({
      reply: turn.assistantMessage,
      routeTrace,
      assertion,
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Test run failed';
    const status = msg.includes('no LLM provider') ? 409 : 500;
    return json({ error: msg }, status);
  }
};

// ─── Assertion handling ──────────────────────────────────────────────────────

type AssertionResult =
  | { mode: 'literal-contains'; verdict: 'pass' | 'fail'; detail: string }
  | { mode: 'regex'; verdict: 'pass' | 'fail'; detail: string }
  | { mode: 'llm-judge'; verdict: 'pass' | 'fail'; detail: string; judgeScore: number | null; judgeRationale: string };

function validateAssertion(a: Assertion): string | null {
  switch (a.mode) {
    case 'literal-contains':
      if (typeof a.value !== 'string' || a.value === '') return 'literal-contains.value must be a non-empty string';
      return null;
    case 'regex':
      if (typeof a.pattern !== 'string' || a.pattern === '') return 'regex.pattern must be a non-empty string';
      try { new RegExp(a.pattern, a.flags ?? ''); } catch (e) {
        return `regex.pattern invalid: ${e instanceof Error ? e.message : 'unknown'}`;
      }
      return null;
    case 'llm-judge':
      if (typeof a.criterion !== 'string' || a.criterion.trim() === '') return 'llm-judge.criterion must be a non-empty string';
      if (typeof a.threshold !== 'number' || a.threshold < 0 || a.threshold > 1) return 'llm-judge.threshold must be between 0 and 1';
      return null;
    default:
      return 'assertion.mode must be one of literal-contains | regex | llm-judge';
  }
}

async function evaluateAssertion(
  a: Assertion,
  reply: string,
  token: string | null,
  agentId: string,
): Promise<AssertionResult> {
  switch (a.mode) {
    case 'literal-contains': {
      const pass = reply.includes(a.value);
      return {
        mode: 'literal-contains',
        verdict: pass ? 'pass' : 'fail',
        detail: pass ? `reply contains "${a.value}"` : `reply did not contain "${a.value}"`,
      };
    }
    case 'regex': {
      const re = new RegExp(a.pattern, a.flags ?? '');
      const pass = re.test(reply);
      return {
        mode: 'regex',
        verdict: pass ? 'pass' : 'fail',
        detail: pass ? `reply matched /${a.pattern}/${a.flags ?? ''}` : `reply did not match /${a.pattern}/${a.flags ?? ''}`,
      };
    }
    case 'llm-judge': {
      const result = await judgeAgentReply({ token, agentId, reply, criterion: a.criterion });
      const v = judgeVerdict(result, a.threshold);
      return {
        mode: 'llm-judge',
        verdict: v.verdict,
        detail: v.detail,
        judgeScore: result.score,
        judgeRationale: result.rationale,
      };
    }
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
