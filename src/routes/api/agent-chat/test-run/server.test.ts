/**
 * Spec 019 T006 + T007 + T015 — /api/agent-chat/test-run endpoint tests.
 *
 * Covers:
 * - Single-message mode happy path: drives START → SEND → PROCESS,
 *   returns reply + routeTrace.
 * - Auth gate (401), input validation (400), unconfigured-LLM gate
 *   (409).
 * - Cross-cutting AgentSubscription side-effect skipped via
 *   `isTestRun: true` on startChat (the only piece of production-state
 *   isolation actually enforced in v1).
 * - US2 (T015): assertion-mode handling for literal-contains, regex,
 *   and llm-judge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { RegexTimeoutError, RegexUnavailableError } from '$lib/server/safe-regex';
import { __resetRateLimit } from '$lib/server/rate-limit';
import { asTesterManager } from '$lib/test/tester-manage';

const mockRequest = vi.fn();
const mockRunChatTurn = vi.fn();
const mockJudgeAgentReply = vi.fn();
// #808: the failure modes that produce `unevaluated` are only reachable by
// overloading the host, which is how the wrong verdict stayed invisible. The
// real implementation stays the default (so the pass/fail cases below still
// exercise a real worker); individual tests override one call.
const mockTestRegexSafely = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (q: string, v?: unknown) => asTesterManager(mockRequest, { visibleAgentIds: ['a'] })(q, v) }),
}));

vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
  fetchAgentAIConfig: vi.fn().mockResolvedValue({
    provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-6',
  }),
}));

vi.mock('$lib/server/agent-tester/llm-judge', async () => {
  // Re-export judgeVerdict (it's pure) but stub judgeAgentReply.
  const actual = await vi.importActual<typeof import('$lib/server/agent-tester/llm-judge')>(
    '$lib/server/agent-tester/llm-judge',
  );
  return {
    ...actual,
    judgeAgentReply: (...args: unknown[]) => mockJudgeAgentReply(...args),
  };
});

vi.mock('$lib/server/safe-regex', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/safe-regex')>(
    '$lib/server/safe-regex',
  );
  return {
    ...actual,
    testRegexSafely: (...args: unknown[]) => mockTestRegexSafely(...args),
  };
});

beforeEach(async () => {
  mockRequest.mockReset();
  mockRunChatTurn.mockReset();
  mockJudgeAgentReply.mockReset();
  // Same shared-budget hazard as the fixtures/run suite: #441's limiter is
  // process-local and every case uses one token. This file's budget is 30/min
  // and it has not tripped yet, which is exactly why it is worth resetting now
  // rather than after the test that finally exceeds it.
  __resetRateLimit();

  const actual = await vi.importActual<typeof import('$lib/server/safe-regex')>(
    '$lib/server/safe-regex',
  );
  mockTestRegexSafely.mockReset();
  mockTestRegexSafely.mockImplementation(
    (...args: Parameters<typeof actual.testRegexSafely>) => actual.testRegexSafely(...args),
  );
});

async function importPOST() {
  const mod = await import('./+server');
  return mod.POST;
}

function ev(opts: {
  body: unknown;
  token?: string | null;
}) {
  return {
    request: new Request('http://test/api/agent-chat/test-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'app-1', ...(opts.body as object) }),
    }),
    locals: { token: opts.token === undefined ? 'test-token' : opts.token, user: { id: 'u1' } },
  } as Parameters<Awaited<ReturnType<typeof importPOST>>>[0];
}

function mockHappyPath() {
  // START_CHAT_MUTATION
  mockRequest.mockImplementation(async (query: string) => {
    if (query === START_CHAT_MUTATION) {
      return {
        startChat: {
          chatId: 'chat-1',
          systemMessage: 'sys',
          tools: null,
          conversationName: 'conversations:setup',
          stageName: 'conversations:setup:onboard',
        },
      };
    }
    // Any other GraphQL call is unexpected for the happy path.
    throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
  });
  // Two runChatTurn calls — welcome then user message.
  mockRunChatTurn
    .mockResolvedValueOnce({
      assistantMessage: 'Welcome! What\'s your name?',
      stageTransitioned: false,
      newStageName: null,
      conversationHandoff: null,
      chatEnded: false,
      onTrack: true,
      offTrackReason: null,
    })
    .mockResolvedValueOnce({
      assistantMessage: 'Hi there!',
      stageTransitioned: false,
      newStageName: null,
      conversationHandoff: null,
      chatEnded: false,
      onTrack: true,
      offTrackReason: null,
    });
}

describe('POST /api/agent-chat/test-run', () => {
  it('does not echo a provider error from the welcome turn', async () => {
    mockRequest.mockResolvedValueOnce({ startChat: {
      chatId: 'c', systemMessage: '', tools: null, conversationName: null, stageName: null,
    } });
    mockRunChatTurn.mockRejectedValueOnce(new Error('Authorization: Bearer sk-synthetic-966'));
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'a', message: 'hello' } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
  });
  it('401 when no auth token', async () => {
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'a', message: 'hi' }, token: null }));
    expect(res.status).toBe(401);
  });

  it('400 on missing required fields', async () => {
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'a' } }));
    expect(res.status).toBe(400);
  });

  it('400 on invalid JSON body', async () => {
    const POST = await importPOST();
    const req = new Request('http://test/api/agent-chat/test-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST({ request: req, locals: { token: 't', user: { id: 'u1' } } } as Parameters<Awaited<ReturnType<typeof importPOST>>>[0]);
    expect(res.status).toBe(400);
  });

  it('happy path: returns reply + routeTrace for a single-message probe', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'a', message: 'hello' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe('Hi there!');
    expect(body.routeTrace.conversationLoc).toBe('conversations:setup');
    expect(body.routeTrace.stageLoc).toBe('conversations:setup:onboard');
    // No assertion was provided.
    expect(body.assertion).toBeNull();
  });

  // Spec 019: the only piece of "production-state isolation" actually
  // enforced in v1 is the AgentSubscription side-effect — gated on the
  // `isTestRun: true` arg the endpoint passes to startChat. Verify the
  // arg is in the GraphQL variables; the server-side test in
  // hadron-server's `resolvers.agentChat.test.ts` covers the
  // skip-on-true assertion against the actual database.
  //
  // (The earlier `SAVE_CHAT_SUMMARY_MUTATION` no-leak assertion was
  // removed — it asserted the endpoint didn't directly call a mutation
  // that lives inside the mocked `runChatTurn` function, so it was
  // structurally incapable of failing. The honest contract is captured
  // here on the call we do make, not on a call we never made.)
  it('passes isTestRun=true and scope=private on startChat', async () => {
    mockHappyPath();
    const POST = await importPOST();
    await POST(ev({ body: { agentId: 'a', message: 'hello' } }));

    const startCall = mockRequest.mock.calls.find((c) => c[0] === START_CHAT_MUTATION);
    expect(startCall).toBeDefined();
    const vars = startCall![1] as Record<string, unknown>;
    expect(vars.isTestRun).toBe(true);
    expect(vars.scope).toBe('private');
  });

  // ─── US2: assertion modes (T015) ───────────────────────────────────────

  it('US2 literal-contains: passes when reply includes the value', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a',
      message: 'hello',
      assertion: { mode: 'literal-contains', value: 'Hi there' },
    } }));
    const body = await res.json();
    expect(body.assertion.verdict).toBe('pass');
    expect(body.assertion.mode).toBe('literal-contains');
  });

  it('US2 literal-contains: fails when the reply does NOT include the value', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'literal-contains', value: 'nope-not-in-reply' },
    } }));
    const body = await res.json();
    expect(body.assertion.verdict).toBe('fail');
    expect(body.assertion.detail).toContain('did not contain');
  });

  it('US2 regex: passes on match, fails on miss', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const passRes = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '^Hi', flags: '' },
    } }));
    expect((await passRes.json()).assertion.verdict).toBe('pass');

    mockHappyPath();
    const failRes = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '^Goodbye', flags: '' },
    } }));
    expect((await failRes.json()).assertion.verdict).toBe('fail');
  });

  it('US2 regex: 400 on malformed pattern', async () => {
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '(unclosed' },
    } }));
    expect(res.status).toBe(400);
  });

  it('US2 llm-judge: pass when score >= threshold', async () => {
    mockHappyPath();
    mockJudgeAgentReply.mockResolvedValueOnce({ score: 0.85, rationale: 'satisfies' });
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'llm-judge', criterion: 'Be welcoming', threshold: 0.7 },
    } }));
    const body = await res.json();
    expect(body.assertion.verdict).toBe('pass');
    expect(body.assertion.judgeScore).toBe(0.85);
    expect(body.assertion.judgeRationale).toBe('satisfies');
  });

  // #808 — this case used to assert `fail`, on the reasoning that a judge
  // failure must not silently pass. Half of that survives and is still pinned
  // below: it is NOT a pass. What changed is that `fail` claimed the reply had
  // been judged and fallen short, when no judge answer ever arrived.
  it('US2 llm-judge: unevaluated (neither pass NOR fail) when score is null', async () => {
    mockHappyPath();
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable (timeout)' });
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'llm-judge', criterion: 'Be welcoming', threshold: 0.7 },
    } }));
    const body = await res.json();
    expect(body.assertion.verdict).toBe('unevaluated');
    // The original guarantee, kept explicit so a later edit cannot quietly
    // restore fail-open behaviour under the new state's cover.
    expect(body.assertion.verdict).not.toBe('pass');
    expect(body.assertion.judgeScore).toBeNull();
  });

  // ─── #808: a run that did not complete is not a verdict about the reply ───

  it('regex: a worker that never starts is unevaluated, not fail', async () => {
    mockHappyPath();
    mockTestRegexSafely.mockRejectedValueOnce(
      new RegexUnavailableError('regex worker did not start within 5000ms'),
    );
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '^Hi', flags: '' },
    } }));
    const body = await res.json();
    expect(body.assertion.verdict).toBe('unevaluated');
    expect(body.assertion.detail).toContain('could not be evaluated');
    // The detail must not blame the caller's pattern: a pattern pathological
    // enough to kill the worker also arrives as RegexUnavailableError, so the
    // #807 wording ("This is not a problem with your pattern") had a reachable
    // counterexample.
    expect(body.assertion.detail).not.toMatch(/not a problem with your pattern/i);
  });

  it('regex: a timed-out match is unevaluated — the reply was never compared', async () => {
    mockHappyPath();
    mockTestRegexSafely.mockRejectedValueOnce(new RegexTimeoutError('regex evaluation timed out'));
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '^Hi', flags: '' },
    } }));
    const body = await res.json();
    // Goes beyond the issue's table on purpose. A timeout says the PATTERN is
    // expensive; it says nothing about whether the reply matched, because the
    // match never finished. `fail` would have claimed it did and lost.
    expect(body.assertion.verdict).toBe('unevaluated');
    expect(body.assertion.detail).toContain('did not finish within its time budget');
  });

  it('regex: a completed non-match is still a plain fail', async () => {
    // The other direction. `unevaluated` must not swallow real failures — if it
    // did, every assertion would stop being able to fail and the whole feature
    // would go quiet.
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'regex', pattern: '^Goodbye', flags: '' },
    } }));
    expect((await res.json()).assertion.verdict).toBe('fail');
  });

  it('US2 llm-judge: 400 on threshold outside [0,1]', async () => {
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'a', message: 'hello',
      assertion: { mode: 'llm-judge', criterion: 'x', threshold: 1.5 },
    } }));
    expect(res.status).toBe(400);
  });

  // ─── Existing T006 case continues ──────────────────────────────────────

  it('stage transition surfaces in routeTrace', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === START_CHAT_MUTATION) {
        return {
          startChat: {
            chatId: 'chat-1', systemMessage: 'sys', tools: null,
            conversationName: 'conversations:setup',
            stageName: 'conversations:setup:onboard',
          },
        };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
    });
    mockRunChatTurn
      .mockResolvedValueOnce({
        assistantMessage: 'Welcome',
        stageTransitioned: false, newStageName: null, conversationHandoff: null,
        chatEnded: false, onTrack: true, offTrackReason: null,
      })
      .mockResolvedValueOnce({
        assistantMessage: 'Done.',
        stageTransitioned: true,
        newStageName: 'conversations:fallback:no-match',
        conversationHandoff: 'conversations:fallback',
        chatEnded: false, onTrack: true, offTrackReason: null,
      });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'a', message: 'switch please' } }));
    const body = await res.json();
    expect(body.routeTrace.stageLoc).toBe('conversations:fallback:no-match');
    expect(body.routeTrace.conversationLoc).toBe('conversations:fallback');
  });
});
