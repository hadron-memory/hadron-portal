import { gqlClient } from '$lib/server/api';
import {
  FIXTURE_NODES_QUERY,
  START_CHAT_MUTATION,
  UPDATE_NODE_MUTATION,
  NODE_BY_ID_QUERY,
} from '$lib/server/queries';
import { requireTesterAgent } from '$lib/server/agent-tester/resolve-agent';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import { llmModelVariable, resolveChatAi } from '$lib/server/llm/chatAi.js';
import { ChatError, publicChatError } from '$lib/server/llm/chatError.js';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import {
  decodeFixture,
  encodeFixture,
  applyRunResult,
  type FixtureRecord,
  type RouteTrace,
  type Assertion,
} from '$lib/server/agent-tester/fixture-codec';
import { judgeAgentReply, judgeVerdict } from '$lib/server/agent-tester/llm-judge';
import { describeRegexFailure, type Verdict } from '$lib/server/agent-tester/verdict';
import { testRegexSafely } from '$lib/server/safe-regex';
import { rateLimitResponse } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';
import { drainFindNodes } from '$lib/server/paginate';

/**
 * POST /api/agent-chat/fixtures/run
 *
 * Spec 019 T028 — Replay one fixture or all fixtures for an agent.
 *
 * Body: { agentId, fixtureLoc?, costCapAcknowledged?: boolean }
 *
 * fixtureLoc null → run all fixtures sequentially.
 *
 * Each run reads the saved fixture, drives the chat platform with its
 * test message, computes drift against the captured baseline, and
 * (single-fixture mode) updates the saved record's baseline only when
 * an "accept new baseline" flag is set — we DON'T silently overwrite
 * baselines on every replay (that would defeat the drift detector).
 *
 * Cost cap: LLM-judge assertions cost tokens. The endpoint estimates
 * cost up-front; if it exceeds the cap AND costCapAcknowledged is
 * not true, returns 409 with the estimate.
 */

const DEFAULT_COST_CAP_USD = 0.10;
// Rough estimates per call on a Claude-Sonnet-class model at typical
// pricing. Real costs vary by provider and model; the goal here is
// order-of-magnitude defense, not accounting.
//
// Per fixture run we make 2 agent LLM calls (welcome turn + the
// user-message turn). The judge is an optional add-on.
//
// Bypass note: this is a per-`Run all` cap — running fixtures one at
// a time still bypasses it. Tightening to a rolling per-org / per-user
// budget is deferred to the production-state-isolation design
// discussion since both concerns share the same architectural seam.
const EST_USD_PER_AGENT_TURN = 0.01;
const EST_AGENT_TURNS_PER_FIXTURE = 2;
const EST_USD_PER_JUDGE_CALL = 0.005;

interface RunBody {
  agentId?: string;
  fixtureLoc?: string | null;
  costCapAcknowledged?: boolean;
  acceptNewBaseline?: boolean; // single-fixture mode only
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  // #441: fan-out endpoint (drives 2 LLM calls per fixture). Rate-limit per
  // user so single-fixture looping can't bypass the per-run cost cap or drain
  // the shared process.
  const limited = rateLimitResponse(locals.user?.id ?? locals.token, 'agent-fixtures-run', 10, 60_000);
  if (limited) return limited;
  let body: RunBody;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body.agentId) return json({ error: 'agentId is required' }, 400);

  const systemMemoryId = (await requireTesterAgent(gqlClient(locals.token), locals.user?.id, body.agentId))?.agent.systemMemoryId;
  if (!systemMemoryId) return json({ error: 'Agent not found or no longer available' }, 404);

  // Collect target fixtures.
  const target = await loadFixtures(locals.token, systemMemoryId, body.fixtureLoc ?? null);
  if (target.length === 0) {
    return json({ error: body.fixtureLoc ? 'Fixture not found' : 'No fixtures to run' }, 404);
  }

  // Cost cap: count both the agent's own LLM turns (2 per fixture)
  // AND the optional llm-judge call (1 per fixture that uses judge
  // mode). The agent calls dominate; counting only the judge — as the
  // pre-salvage version did — under-reported by an order of magnitude.
  const judgeCalls = target.filter((t) => t.record.turns[0].assertion?.mode === 'llm-judge').length;
  const agentCost = target.length * EST_AGENT_TURNS_PER_FIXTURE * EST_USD_PER_AGENT_TURN;
  const judgeCost = judgeCalls * EST_USD_PER_JUDGE_CALL;
  const estimatedCost = agentCost + judgeCost;
  if (estimatedCost > DEFAULT_COST_CAP_USD && !body.costCapAcknowledged) {
    return json({
      error: 'cost-cap-exceeded',
      estimatedCost: { currency: 'USD', amount: Number(estimatedCost.toFixed(2)) },
      cap: { currency: 'USD', amount: DEFAULT_COST_CAP_USD },
    }, 409);
  }

  // Run sequentially with per-fixture error isolation. Parallel
  // execution was considered (per PR #217 review) but would race on
  // LLM provider rate limits and complicate progress reporting; v1
  // fixture counts are expected in the low tens, so sequential meets
  // the latency budget. What we MUST get right is error isolation:
  // a single fixture's transient failure (network blip, model
  // refusal, prompt error) should not abort the whole batch — the
  // drift report is most valuable when every fixture is accounted
  // for, even those that errored.
  const results: Array<RunOneResult | RunErrorResult> = [];
  // #808: `unevaluated` is counted on its own. Folding it into `failed` — which
  // is what `else failed++` did — is the summary-line version of the same wrong
  // claim: a run bar reading "3 failed" after three worker failures says the
  // agent regressed on three fixtures when it was never measured on any.
  let passed = 0, failed = 0, errored = 0, unevaluated = 0;
  for (const t of target) {
    let result: RunOneResult | RunErrorResult;
    try {
      result = await runOneFixture(locals.token, body.agentId, t);
      const v = (result as RunOneResult).newVerdict;
      if (v === 'pass') passed++;
      else if (v === 'fail') failed++;
      else unevaluated++;
    } catch (e) {
      errored++;
      result = {
        fixtureLoc: t.loc,
        error: publicChatError(e).message,
      };
    }
    results.push(result);

    // Optional baseline update — single-fixture mode only, and only
    // when the run produced a real result (not an error).
    if (body.fixtureLoc && body.acceptNewBaseline && !('error' in result)) {
      const r = result as RunOneResult;
      // #808: a baseline records what this fixture is EXPECTED to do, and an
      // unevaluated run establishes no expectation. Writing it would bake a
      // transient worker or judge failure into the fixture as its accepted
      // behaviour, and the next replay would then compare against a non-result.
      // The refusal is reported on the result rather than swallowed, so the
      // caller does not read "accepted" into a button that did nothing.
      if (r.newVerdict === 'unevaluated') {
        // `r` is the object already pushed above, so this reaches the response.
        r.baselineRefused = 'the assertion did not run, so there is no verdict to accept as a baseline';
      } else {
        try {
          await persistNewBaseline(locals.token, systemMemoryId, t.loc, t.record, {
            reply: r.newReply, route: r.newRoute, verdict: r.newVerdict,
          });
        } catch {
          // Persist failures don't change the drift report; surface
          // only in logs (caller already has the new baseline in the
          // response and can retry).
        }
      }
    }
  }

  return json({
    results,
    summary: {
      totalRuns: target.length,
      passed,
      failed,
      errored,
      unevaluated,
      estimatedCost: { currency: 'USD', amount: Number(estimatedCost.toFixed(2)) },
      exceededCap: estimatedCost > DEFAULT_COST_CAP_USD,
    },
  }, 200);
};

interface RunErrorResult {
  fixtureLoc: string;
  error: string;
}

// ── Fixture loading ─────────────────────────────────────────────────────────

interface LoadedFixture { nodeId: string; loc: string; record: FixtureRecord; }

async function loadFixtures(
  token: string,
  systemMemoryId: string,
  filterLoc: string | null,
): Promise<LoadedFixture[]> {
  const client = gqlClient(token);
  // hrn:node:hadronmemory.com:specs:cor:api:090:02: explicit memory scope does not lift the independent
  // system-node exclusion. Fixtures are system nodes (#1202).
  const result = await drainFindNodes<{ node: {
    id: string; loc: string; memoryId: string; data: unknown;
  } }>(client, FIXTURE_NODES_QUERY, { memoryIds: [systemMemoryId] });
  const out: LoadedFixture[] = [];
  for (const h of result.findNodes?.hits ?? []) {
    const n = h.node;
    if (n.memoryId !== systemMemoryId) continue;
    if (!n.loc.startsWith('fixtures:')) continue;
    if (filterLoc && n.loc !== filterLoc) continue;
    const record = decodeFixture(n.data);
    if (!record) continue;
    out.push({ nodeId: n.id, loc: n.loc, record });
  }
  return out;
}

// ── Run-one ─────────────────────────────────────────────────────────────────

interface RunOneResult {
  fixtureLoc: string;
  newReply: string;
  newRoute: RouteTrace;
  newVerdict: Verdict;
  newDetail: string;
  drift: {
    reply: 'same' | 'different';
    route: 'same' | 'different';
    verdict: 'still-passing' | 'still-failing' | 'newly-passing' | 'newly-failing' | 'no-baseline' | 'unevaluated';
  };
  /**
   * #808: set only when `acceptNewBaseline` was requested and the run produced
   * no verdict to baseline. Reported rather than skipped silently — the caller
   * asked for a write and is entitled to know it did not happen.
   */
  baselineRefused?: string;
}

async function runOneFixture(
  token: string,
  agentId: string,
  fixture: LoadedFixture,
): Promise<RunOneResult> {
  const turn = fixture.record.turns[0];
  const client = gqlClient(token);

  // portal#1611: one resolution per fixture chat, before startChat, shared by
  // its welcome turn and its fixture turn.
  const ai = await resolveChatAi(token, agentId);

  const startResult = await client.request<{
    startChat: {
      chatId: string;
      systemMessage: string;
      tools: HadronTool[] | null;
      conversationName: string | null;
      stageName: string | null;
    };
  }>(START_CHAT_MUTATION, {
    agentRef: agentId,
    conversationName: null,
    // Spec 019: match the test-run endpoint's posture. scope hardcoded
    // to private (no sharing a fixture run across AppMembers);
    // isTestRun skips the AgentSubscription side-effect.
    scope: 'private',
    isTestRun: true,
    ...llmModelVariable(ai),
  });

  const { chatId, conversationName, stageName } = startResult.startChat;

  // Welcome turn: capture any transitions it triggers so the route
  // trace reflects where the user message actually landed (same
  // fix as test-run/+server.ts; see PR #217 review).
  const welcomeTurn = await runChatTurn({
    token, agentId, chatId, userMessage: null, ai,
    startPayload: {
      systemMessage: startResult.startChat.systemMessage,
      tools: startResult.startChat.tools,
    },
  });

  // A fixture asserts the reply to its user message. Once the welcome turn
  // ends the chat, there can be no such reply or verdict to compare or save.
  // The caller isolates this as one fixture error and continues the batch.
  if (welcomeTurn.chatEnded) {
    throw new ChatError('fixtureEndedWelcome');
  }

  const t = await runChatTurn({ token, agentId, chatId, userMessage: turn.user, ai });

  const newRoute: RouteTrace = {
    conversationLoc: t.conversationHandoff ?? welcomeTurn.conversationHandoff ?? conversationName ?? null,
    stageLoc: t.newStageName ?? welcomeTurn.newStageName ?? stageName ?? null,
    personaName: turn.persona,
  };

  const { verdict, detail } = await evaluateAssertion(turn.assertion, t.assistantMessage, token, agentId);

  const drift = computeDrift(turn, t.assistantMessage, newRoute, verdict);

  return {
    fixtureLoc: fixture.loc,
    newReply: t.assistantMessage,
    newRoute,
    newVerdict: verdict,
    newDetail: detail,
    drift,
  };
}

async function evaluateAssertion(
  a: Assertion | null,
  reply: string,
  token: string,
  agentId: string,
): Promise<{ verdict: Verdict; detail: string }> {
  // No assertion = the run is a probe; verdict is "pass" by convention
  // (we're just capturing baselines). The drift detector still compares
  // the reply against the captured one.
  //
  // #808 deliberately leaves this convention alone. It is not the defect that
  // issue describes — nothing ran and lost here, because the fixture asserts
  // nothing — and every probe-only fixture already on disk carries `pass` as
  // its stored baseline, so re-reading it as `unevaluated` would report drift
  // on fixtures nobody touched.
  if (!a) return { verdict: 'pass', detail: 'probe-only (no assertion)' };
  if (a.mode === 'literal-contains') {
    const pass = reply.includes(a.value);
    return { verdict: pass ? 'pass' : 'fail', detail: pass ? `contains "${a.value}"` : `did not contain "${a.value}"` };
  }
  if (a.mode === 'regex') {
    // #440: time-bounded match in a worker thread (ReDoS-safe).
    let pass: boolean;
    try {
      pass = await testRegexSafely(a.pattern, a.flags ?? '', reply);
    } catch (e) {
      // #808: nothing reaching here produced a comparison, so none of it is a
      // `fail`. This branch ALSO had the #807 fix missing — it never learned
      // about RegexUnavailableError, so a worker that failed to start surfaced
      // a raw internal message ("regex worker did not start within 5000ms") as
      // a verdict about the user's agent. Both evaluators now share one
      // description helper so they cannot drift apart again.
      return { verdict: 'unevaluated', detail: describeRegexFailure(e) };
    }
    return { verdict: pass ? 'pass' : 'fail', detail: pass ? `matched /${a.pattern}/${a.flags ?? ''}` : `did not match /${a.pattern}/${a.flags ?? ''}` };
  }
  // llm-judge
  const judge = await judgeAgentReply({ token, agentId, reply, criterion: a.criterion });
  return judgeVerdict(judge, a.threshold);
}

function computeDrift(
  turn: FixtureRecord['turns'][number],
  newReply: string,
  newRoute: RouteTrace,
  newVerdict: Verdict,
): RunOneResult['drift'] {
  if (turn.capturedAt === null) {
    return { reply: 'different', route: 'different', verdict: 'no-baseline' };
  }
  const replyDrift = turn.capturedReply === newReply ? 'same' : 'different';
  const routeDrift =
    turn.capturedRoute?.conversationLoc === newRoute.conversationLoc &&
    turn.capturedRoute?.stageLoc === newRoute.stageLoc
      ? 'same' : 'different';

  // #808: drift compares a baseline verdict against a NEW one, so an
  // unevaluated run has nothing to compare and must say so.
  //
  // The trailing `else verdictDrift = 'newly-failing'` this replaces is the
  // reason it needs its own state rather than a widened union alone: that
  // branch was written for "the new verdict is fail", and it inherited
  // "unevaluated" the moment the union grew. A user whose worker thread failed
  // would have read `Newly failing` on a green fixture — a regression report
  // manufactured out of a run that never happened.
  //
  // Reply and route drift are still computed and still meaningful: the chat
  // turn itself ran fine, and only the assertion did not.
  let verdictDrift: RunOneResult['drift']['verdict'];
  if (newVerdict === 'unevaluated') verdictDrift = 'unevaluated';
  else if (turn.capturedVerdict === 'pass' && newVerdict === 'pass') verdictDrift = 'still-passing';
  else if (turn.capturedVerdict === 'fail' && newVerdict === 'fail') verdictDrift = 'still-failing';
  else if (newVerdict === 'pass') verdictDrift = 'newly-passing';
  else verdictDrift = 'newly-failing';

  return { reply: replyDrift, route: routeDrift, verdict: verdictDrift };
}

// ── Baseline update ─────────────────────────────────────────────────────────

async function persistNewBaseline(
  token: string,
  systemMemoryId: string,
  loc: string,
  record: FixtureRecord,
  // #808: `Verdict` deliberately does NOT widen here. A stored baseline is an
  // expectation, and `unevaluated` is the absence of one — so the narrower type
  // is the guard: the caller has to rule it out before it can call this, and
  // the compiler says so rather than a runtime check nobody reads.
  result: { reply: string; route: RouteTrace; verdict: 'pass' | 'fail' },
): Promise<void> {
  // hadron-server#460: the fixture node was just read to run it, so this is
  // a pure update (updateNode preserves the omitted nodeType/description).
  const updated = applyRunResult(record, result);
  await gqlClient(token).request(UPDATE_NODE_MUTATION, {
    input: {
      memoryId: systemMemoryId,
      loc,
      name: updated.label,
      data: encodeFixture(updated),
    },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
