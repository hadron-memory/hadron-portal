import { gqlClient } from '$lib/server/api';
import { appRefVariable, appRequiredResponse, cleanChatAppRef } from '$lib/server/llm/chatApp.js';
import { requireTesterAgent } from '$lib/server/agent-tester/resolve-agent';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import { llmModelVariable, resolveChatAi } from '$lib/server/llm/chatAi.js';
import { publicChatError } from '$lib/server/llm/chatError.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import { judgeAgentReply, judgeVerdict } from '$lib/server/agent-tester/llm-judge';
import { describeRegexFailure, type Verdict } from '$lib/server/agent-tester/verdict';
import { testRegexSafely, MAX_PATTERN_LEN, MAX_FLAGS_LEN } from '$lib/server/safe-regex';
import { rateLimitResponse } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/test-run
 *
 * Spec 019 — Agent Chat Tester. Runs a single test message against an
 * agent's chatbot and returns the reply plus a structured route trace.
 * In US2, the endpoint also evaluates an optional assertion in one of
 * three modes: literal-contains, regex, or llm-judge.
 *
 * Production-state isolation (FR-015 / SC-005) is **partial** in v1.
 * The endpoint passes `isTestRun: true` to `startChat`, which skips
 * the cross-cutting `AgentSubscription` auto-provision side-effect
 * (the only piece that bleeds beyond the chatbot feature into the
 * platform's license-grant model). The chat itself still creates real
 * chat-root + message + route-history rows in the user's per-agent
 * memory, and the agent's extraction spec still writes back facts.
 * Full isolation is the topic of the
 * `tester-vs-production-memory-boundary` design discussion. Users are
 * notified of the v1 limitation in the Tester UI.
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
  /** portal#2683: the App the Tester runs under (one that installs the Agent). */
  appId?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // #441: bound how often a single user can drive real LLM calls through the
  // tester, so one tenant can't exhaust provider budget / occupy the shared
  // adapter-node process.
  const limited = rateLimitResponse(locals.user?.id ?? locals.token, 'agent-test-run', 30, 60_000);
  if (limited) return limited;

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
  // portal#2683: the Tester names the App it tests under; no App is refused before anything runs.
  const appRef = cleanChatAppRef(body.appId);
  if (!appRef) return appRequiredResponse();

  if (body.assertion) {
    const validationError = validateAssertion(body.assertion);
    if (validationError) return json({ error: validationError }, 400);
  }

  try {
    const client = gqlClient(locals.token);

    // portal#2083: the Tester is manager-only. Same resolve as every other
    // Tester surface, BEFORE any AI resolution or startChat; a miss is the
    // existing not-found, a failed read lands in the catch below.
    if (!(await requireTesterAgent(client, locals.user?.id, body.agentId))) {
      return json({ error: 'Agent not found or no longer available' }, 404);
    }

    // portal#1611: resolve the AI config once, before startChat; the same
    // resolution serves the welcome turn and the user-message turn.
    const ai = await resolveChatAi(locals.token, body.agentId);

    // Spec 019: scope hardcoded to 'private' — no user-facing knob.
    // Sharing a test run to every AppMember would be a privacy/audit
    // hazard that the Tester is supposed to avoid. isTestRun=true skips
    // the AgentSubscription auto-provision side-effect on the server.
    const startResult = await client.request<{
      startChat: {
        chatId: string;
        systemMessage: string;
        tools: HadronTool[] | null;
        conversationName: string | null;
        stageName: string | null;
      };
    }>(START_CHAT_MUTATION, {
      agentRef: body.agentId,
      ...appRefVariable(appRef),
      conversationName: null,
      scope: 'private',
      isTestRun: true,
      ...llmModelVariable(ai),
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
      ai,
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
      ai,
    });

    // Resolve conversation + stage with welcome-turn results as the
    // fallback so a transition triggered by the welcome is preserved.
    const finalConversation =
      turn.conversationHandoff ?? welcomeTurn.conversationHandoff ?? conversationName ?? null;
    const finalStage =
      turn.newStageName ?? welcomeTurn.newStageName ?? stageName ?? null;

    // NOTE: `personaName` is **metadata-only**. `runChatTurn` takes no
    // persona override, and nothing else in the platform applies one
    // (#897: the MCP persona runner this comment used to recommend was
    // removed in hadron-server#1143). We surface the user's input so
    // the UI can show what they asked for, but the bot's routing is its
    // default. The Tester's Scripted persona (multi-turn) section,
    // backed by /api/agent-chat/test-persona, runs a whole scripted
    // conversation; its persona name is a label too.
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
    const safe = publicChatError(e);
    return json({ error: safe.message, code: safe.code }, safe.status);
  }
};

// ─── Assertion handling ──────────────────────────────────────────────────────

// #808: `verdict` carries three states, not two. See
// `$lib/server/agent-tester/verdict` for what each one is allowed to claim —
// in short, `fail` is a claim about the reply and `unevaluated` is the absence
// of one.
type AssertionResult =
  | { mode: 'literal-contains'; verdict: Verdict; detail: string }
  | { mode: 'regex'; verdict: Verdict; detail: string }
  | { mode: 'llm-judge'; verdict: Verdict; detail: string; judgeScore: number | null; judgeRationale: string };

function validateAssertion(a: Assertion): string | null {
  switch (a.mode) {
    case 'literal-contains':
      if (typeof a.value !== 'string' || a.value === '') return 'literal-contains.value must be a non-empty string';
      return null;
    case 'regex':
      if (typeof a.pattern !== 'string' || a.pattern === '') return 'regex.pattern must be a non-empty string';
      if (a.pattern.length > MAX_PATTERN_LEN) return `regex.pattern must be at most ${MAX_PATTERN_LEN} characters`;
      if (a.flags != null && (typeof a.flags !== 'string' || a.flags.length > MAX_FLAGS_LEN || !/^[dgimsuy]*$/.test(a.flags)))
        return 'regex.flags must contain only valid flag characters (dgimsuy)';
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
      // #440: match in a time-bounded worker thread so a catastrophic pattern
      // can't pin the event loop.
      let pass: boolean;
      try {
        pass = await testRegexSafely(a.pattern, a.flags ?? '', reply);
      } catch (e) {
        // #800: "too complex" is a claim about the CALLER'S pattern, and it used
        // to be produced by a busy SERVER — the timeout covered worker startup,
        // so `^Hi` could be reported as catastrophic. The budget now bounds the
        // match, and a startup failure has its own type so the two can no longer
        // be confused in the one place a user reads.
        //
        // #808 finishes it: NOTHING that lands here ran to completion, so none of
        // it can be reported as `fail` — that would claim the reply lost a
        // comparison never made. The verdict is a property of the run (it did not
        // finish), not a lookup on the error type, so a new error type added
        // later cannot be misfiled into a claim about the reply.
        return { mode: 'regex', verdict: 'unevaluated', detail: describeRegexFailure(e) };
      }
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
