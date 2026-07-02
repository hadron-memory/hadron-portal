import { gqlClient } from '$lib/server/api';
import {
  MY_ORGANIZATIONS_QUERY,
  GRAPH_NODES_QUERY,
  START_CHAT_MUTATION,
  UPDATE_NODE_MUTATION,
  NODE_BY_ID_QUERY,
} from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
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
import type { Organization } from '$lib/types';
import type { RequestHandler } from './$types';

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

async function resolveAgent(token: string, agentId: string): Promise<{
  agentId: string;
  systemMemoryId: string;
} | null> {
  const data = await gqlClient(token).request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY);
  for (const o of data.myOrganizations) {
    const a = (o.agents ?? []).find((x) => x.id === agentId);
    if (a) {
      const memId = (a as unknown as { systemMemoryId?: string | null }).systemMemoryId ?? null;
      if (!memId) return null;
      return { agentId, systemMemoryId: memId };
    }
  }
  return null;
}

interface RunBody {
  agentId?: string;
  fixtureLoc?: string | null;
  costCapAcknowledged?: boolean;
  acceptNewBaseline?: boolean; // single-fixture mode only
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  let body: RunBody;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body.agentId) return json({ error: 'agentId is required' }, 400);

  const resolved = await resolveAgent(locals.token, body.agentId);
  if (!resolved) return json({ error: 'Agent not found or no longer available' }, 404);

  // Collect target fixtures.
  const target = await loadFixtures(locals.token, resolved.systemMemoryId, body.fixtureLoc ?? null);
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
  let passed = 0, failed = 0, errored = 0;
  for (const t of target) {
    let result: RunOneResult | RunErrorResult;
    try {
      result = await runOneFixture(locals.token, body.agentId, t);
      if ((result as RunOneResult).newVerdict === 'pass') passed++; else failed++;
    } catch (e) {
      errored++;
      result = {
        fixtureLoc: t.loc,
        error: e instanceof Error ? e.message : 'Run failed',
      };
    }
    results.push(result);

    // Optional baseline update — single-fixture mode only, and only
    // when the run produced a real result (not an error).
    if (body.fixtureLoc && body.acceptNewBaseline && !('error' in result)) {
      const r = result as RunOneResult;
      try {
        await persistNewBaseline(locals.token, resolved.systemMemoryId, t.loc, t.record, {
          reply: r.newReply, route: r.newRoute, verdict: r.newVerdict,
        });
      } catch {
        // Persist failures don't change the drift report; surface
        // only in logs (caller already has the new baseline in the
        // response and can retry).
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
  // Scope to the agent's system memory — findNodes hides class:'system'
  // memories on a broad (no-memoryIds) call, so naming it is what surfaces the
  // fixture nodes (and overrides the exclusion).
  const result = await client.request<{ findNodes: { hits: Array<{ node: {
    id: string; loc: string; memoryId: string; data: unknown;
  } }> } }>(GRAPH_NODES_QUERY, { limit: 500, memoryIds: [systemMemoryId] });
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
  newVerdict: 'pass' | 'fail';
  newDetail: string;
  drift: {
    reply: 'same' | 'different';
    route: 'same' | 'different';
    verdict: 'still-passing' | 'still-failing' | 'newly-passing' | 'newly-failing' | 'no-baseline';
  };
}

async function runOneFixture(
  token: string,
  agentId: string,
  fixture: LoadedFixture,
): Promise<RunOneResult> {
  const turn = fixture.record.turns[0];
  const client = gqlClient(token);

  const startResult = await client.request<{
    startChat: {
      chatId: string;
      systemMessage: string;
      tools: HadronTool[] | null;
      conversationName: string | null;
      stageName: string | null;
    };
  }>(START_CHAT_MUTATION, {
    agentId,
    conversationName: null,
    // Spec 019: match the test-run endpoint's posture. scope hardcoded
    // to private (no sharing a fixture run across AppMembers);
    // isTestRun skips the AgentSubscription side-effect.
    scope: 'private',
    isTestRun: true,
  });

  const { chatId, conversationName, stageName } = startResult.startChat;

  // Welcome turn: capture any transitions it triggers so the route
  // trace reflects where the user message actually landed (same
  // fix as test-run/+server.ts; see PR #217 review).
  const welcomeTurn = await runChatTurn({
    token, agentId, chatId, userMessage: null,
    startPayload: {
      systemMessage: startResult.startChat.systemMessage,
      tools: startResult.startChat.tools,
    },
  });

  const t = await runChatTurn({ token, agentId, chatId, userMessage: turn.user });

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
): Promise<{ verdict: 'pass' | 'fail'; detail: string }> {
  // No assertion = the run is a probe; verdict is "pass" by convention
  // (we're just capturing baselines). The drift detector still compares
  // the reply against the captured one.
  if (!a) return { verdict: 'pass', detail: 'probe-only (no assertion)' };
  if (a.mode === 'literal-contains') {
    const pass = reply.includes(a.value);
    return { verdict: pass ? 'pass' : 'fail', detail: pass ? `contains "${a.value}"` : `did not contain "${a.value}"` };
  }
  if (a.mode === 'regex') {
    const re = new RegExp(a.pattern, a.flags ?? '');
    const pass = re.test(reply);
    return { verdict: pass ? 'pass' : 'fail', detail: pass ? `matched /${a.pattern}/` : `did not match /${a.pattern}/` };
  }
  // llm-judge
  const judge = await judgeAgentReply({ token, agentId, reply, criterion: a.criterion });
  return judgeVerdict(judge, a.threshold);
}

function computeDrift(
  turn: FixtureRecord['turns'][number],
  newReply: string,
  newRoute: RouteTrace,
  newVerdict: 'pass' | 'fail',
): RunOneResult['drift'] {
  if (turn.capturedAt === null) {
    return { reply: 'different', route: 'different', verdict: 'no-baseline' };
  }
  const replyDrift = turn.capturedReply === newReply ? 'same' : 'different';
  const routeDrift =
    turn.capturedRoute?.conversationLoc === newRoute.conversationLoc &&
    turn.capturedRoute?.stageLoc === newRoute.stageLoc
      ? 'same' : 'different';

  let verdictDrift: RunOneResult['drift']['verdict'];
  if (turn.capturedVerdict === 'pass' && newVerdict === 'pass') verdictDrift = 'still-passing';
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
