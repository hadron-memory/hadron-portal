/**
 * Spec 019 T025 — /api/agent-chat/fixtures/run endpoint tests.
 *
 * Covers: single-fixture replay, run-all, drift computation, cost-cap
 * branch, and "no baseline yet" handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORGANIZATIONS_QUERY,
  GRAPH_NODES_QUERY,
  START_CHAT_MUTATION,
  UPDATE_NODE_MUTATION,
} from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';

const mockRequest = vi.fn();
const mockRunChatTurn = vi.fn();
const mockJudgeAgentReply = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
  fetchAgentAIConfig: vi.fn().mockResolvedValue({
    provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-6',
  }),
}));

vi.mock('$lib/server/agent-tester/llm-judge', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/agent-tester/llm-judge')>(
    '$lib/server/agent-tester/llm-judge',
  );
  return {
    ...actual,
    judgeAgentReply: (...args: unknown[]) => mockJudgeAgentReply(...args),
  };
});

beforeEach(() => {
  mockRequest.mockReset();
  mockRunChatTurn.mockReset();
  mockJudgeAgentReply.mockReset();
  // #441's limiter is a process-local Map keyed on the caller's token, and
  // every case here uses the same one — so its budget (10/min) was being spent
  // ACROSS tests, not within them. It went unnoticed while the file had fewer
  // cases than the budget; adding four tipped it, and the failure surfaced on
  // the last two tests in the file rather than on the ones that caused it.
  __resetRateLimit();
});

async function importPOST() {
  const mod = await import('./+server');
  return mod.POST;
}

function ev(opts: { body: unknown; token?: string | null }) {
  return {
    request: new Request('http://test/api/agent-chat/fixtures/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body),
    }),
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
  } as Parameters<Awaited<ReturnType<typeof importPOST>>>[0];
}

function fixtureNode(loc: string, opts: { assertionMode?: 'literal-contains' | 'llm-judge'; captureReply?: string | null; captureVerdict?: 'pass' | 'fail' | null } = {}) {
  return {
    id: loc.replace('fixtures:', 'node-'),
    loc,
    memoryId: 'sys-mem-a',
    data: {
      version: 1,
      label: 'lbl',
      turns: [{
        user: 'hello',
        persona: null,
        assertion: opts.assertionMode === 'literal-contains'
          ? { mode: 'literal-contains', value: 'Welcome' } // matches default reply "Hi! Welcome."
          : opts.assertionMode === 'llm-judge'
            ? { mode: 'llm-judge', criterion: 'be welcoming', threshold: 0.7 }
            : null,
        capturedReply: opts.captureReply === undefined ? 'Hi! Welcome.' : opts.captureReply,
        capturedRoute: opts.captureReply === null ? null : { conversationLoc: 'c', stageLoc: 's', personaName: null },
        capturedVerdict: opts.captureVerdict === undefined ? 'pass' : opts.captureVerdict,
        capturedAt: opts.captureReply === null ? null : '2026-05-13T00:00:00.000Z',
      }],
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
    },
  };
}

// Mock the chat-platform end-to-end and provide configurable nodes.
function setupChat(opts: {
  nodes: ReturnType<typeof fixtureNode>[];
  replyText?: string;
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: [
        { id: 'org-a', name: 'A', urn: 'u', agents: [
          { id: 'agent-aaa', organizationId: 'org-a', systemMemoryId: 'sys-mem-a' },
        ] },
      ], total: 1 } };
    }
    if (query === GRAPH_NODES_QUERY) return { findNodes: { hits: opts.nodes.map((node) => ({ node })) } };
    if (query === START_CHAT_MUTATION) {
      return { startChat: {
        chatId: 'c1', systemMessage: 'sys', tools: null,
        conversationName: 'c', stageName: 's',
      } };
    }
    if (query === UPDATE_NODE_MUTATION) return { updateNode: { id: 'n', loc: 'fixtures:abc' } };
    throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
  });
  // Welcome + user turn.
  mockRunChatTurn
    .mockResolvedValueOnce({
      assistantMessage: 'welcome turn discarded',
      stageTransitioned: false, newStageName: null, conversationHandoff: null,
      chatEnded: false, onTrack: true, offTrackReason: null,
    })
    .mockResolvedValueOnce({
      assistantMessage: opts.replyText ?? 'Hi! Welcome.',
      stageTransitioned: false, newStageName: null, conversationHandoff: null,
      chatEnded: false, onTrack: true, offTrackReason: null,
    });
}

describe('POST /api/agent-chat/fixtures/run', () => {
  it('single fixture replay: reports still-passing when reply matches baseline', async () => {
    setupChat({ nodes: [fixtureNode('fixtures:abc', { assertionMode: 'literal-contains' })] });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalRuns).toBe(1);
    expect(body.summary.passed).toBe(1);
    expect(body.results[0].drift.verdict).toBe('still-passing');
    expect(body.results[0].drift.reply).toBe('same');
  });

  it('single fixture replay: reports newly-failing when reply changed AND assertion now fails', async () => {
    setupChat({
      nodes: [fixtureNode('fixtures:abc', { assertionMode: 'literal-contains' })],
      replyText: 'Yes?', // does NOT contain "welcome"
    });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    const body = await res.json();
    expect(body.results[0].newVerdict).toBe('fail');
    expect(body.results[0].drift.verdict).toBe('newly-failing');
    expect(body.results[0].drift.reply).toBe('different');
  });

  // ─── #808: a replay that produced no verdict is not a regression ──────────

  it('an unevaluated replay reports drift "unevaluated", NOT "newly-failing"', async () => {
    // The defect this pins is the drift fallback, not the verdict alone. The
    // old trailing `else verdictDrift = 'newly-failing'` was written for "the
    // new verdict is fail" and inherited "unevaluated" the moment the union
    // grew — so an unreachable judge would have been reported to the user as a
    // fixture that started failing, on a green baseline, with nothing about the
    // agent having changed.
    setupChat({ nodes: [fixtureNode('fixtures:abc', { assertionMode: 'llm-judge' })] });
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable (timeout)' });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    const body = await res.json();
    expect(body.results[0].newVerdict).toBe('unevaluated');
    expect(body.results[0].drift.verdict).toBe('unevaluated');
    expect(body.results[0].drift.verdict).not.toBe('newly-failing');
    // Reply and route drift ARE still computed — the chat turn ran fine, and
    // only the assertion did not. Losing them would trade one silence for another.
    expect(body.results[0].drift.reply).toBe('same');
    expect(body.results[0].drift.route).toBe('same');
  });

  it('summary counts an unevaluated run apart from failures', async () => {
    setupChat({ nodes: [fixtureNode('fixtures:abc', { assertionMode: 'llm-judge' })] });
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable' });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    const body = await res.json();
    expect(body.summary.unevaluated).toBe(1);
    // "1 failed" on this run would say the agent regressed on a fixture it was
    // never measured against.
    expect(body.summary.failed).toBe(0);
    expect(body.summary.passed).toBe(0);
    expect(body.summary.errored).toBe(0);
  });

  it('acceptNewBaseline refuses an unevaluated run, and says so', async () => {
    setupChat({ nodes: [fixtureNode('fixtures:abc', { assertionMode: 'llm-judge' })] });
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable' });
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc', acceptNewBaseline: true,
    } }));
    const body = await res.json();
    // The write must not happen: baselining a non-result would freeze a
    // transient judge outage into the fixture as its expected behaviour.
    expect(mockRequest.mock.calls.some((c) => c[0] === UPDATE_NODE_MUTATION)).toBe(false);
    // And it must not happen SILENTLY — the caller asked for a write.
    expect(body.results[0].baselineRefused).toMatch(/no verdict/);
  });

  it('acceptNewBaseline still writes when the run DID produce a verdict', async () => {
    // The other direction: the refusal must be scoped to unevaluated runs, or
    // it quietly breaks the feature it is guarding.
    setupChat({ nodes: [fixtureNode('fixtures:abc', { assertionMode: 'literal-contains' })] });
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc', acceptNewBaseline: true,
    } }));
    const body = await res.json();
    expect(mockRequest.mock.calls.some((c) => c[0] === UPDATE_NODE_MUTATION)).toBe(true);
    expect(body.results[0].baselineRefused).toBeUndefined();
  });

  // @codex P2 on #812. `computeDrift` returns `no-baseline` before it looks at
  // the verdict at all, so these two facts are simultaneously true and the
  // drift field can carry only one of them. That is fine for drift — with no
  // baseline there is genuinely nothing to compare — but it means `newVerdict`
  // is the ONLY field that answers "did this run produce a verdict", and
  // anything gating on that question has to read it. The UI was reading drift,
  // and offered "Accept new baseline" on exactly this fixture.
  it('an unevaluated run with no baseline: drift says no-baseline, newVerdict still says unevaluated', async () => {
    setupChat({
      nodes: [fixtureNode('fixtures:abc', {
        assertionMode: 'llm-judge',
        captureReply: null, captureVerdict: null,
      })],
    });
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable' });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    const body = await res.json();
    expect(body.results[0].drift.verdict).toBe('no-baseline');
    expect(body.results[0].newVerdict).toBe('unevaluated');
    expect(body.summary.unevaluated).toBe(1);
  });

  it('and the baseline write is still refused in that case', async () => {
    // The endpoint was already correct here — it gates on the verdict. Pinned
    // so the server side cannot regress into agreeing with the old UI gate.
    setupChat({
      nodes: [fixtureNode('fixtures:abc', {
        assertionMode: 'llm-judge',
        captureReply: null, captureVerdict: null,
      })],
    });
    mockJudgeAgentReply.mockResolvedValueOnce({ score: null, rationale: 'judge unreachable' });
    const POST = await importPOST();
    const res = await POST(ev({ body: {
      agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc', acceptNewBaseline: true,
    } }));
    const body = await res.json();
    expect(mockRequest.mock.calls.some((c) => c[0] === UPDATE_NODE_MUTATION)).toBe(false);
    expect(body.results[0].baselineRefused).toMatch(/no verdict/);
  });

  it('no-baseline fixture: drift.verdict = "no-baseline"', async () => {
    setupChat({
      nodes: [fixtureNode('fixtures:abc', {
        assertionMode: 'literal-contains',
        captureReply: null, captureVerdict: null,
      })],
    });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:abc' } }));
    const body = await res.json();
    expect(body.results[0].drift.verdict).toBe('no-baseline');
  });

  it('run-all: iterates every fixture in the agent\'s system memory', async () => {
    setupChat({ nodes: [
      fixtureNode('fixtures:abc', { assertionMode: 'literal-contains' }),
      fixtureNode('fixtures:def', { assertionMode: 'literal-contains' }),
    ] });
    // setupChat mocked 2 runChatTurn calls; for 2 fixtures we need 4.
    mockRunChatTurn
      .mockResolvedValueOnce({ assistantMessage: 'welcome 2', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null })
      .mockResolvedValueOnce({ assistantMessage: 'Hi! Welcome.', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa' } })); // no fixtureLoc → all
    const body = await res.json();
    expect(body.summary.totalRuns).toBe(2);
  });

  it('cost-cap exceeded: returns 409 with the estimate when batch cost exceeds the cap', async () => {
    // 25 fixtures × 2 agent-turns × $0.01 = $0.50 agent cost,
    // + 25 llm-judge × $0.005 = $0.125 judge cost
    // = $0.625 total > $0.10 default cap.
    const nodes = Array.from({ length: 25 }, (_, i) =>
      fixtureNode(`fixtures:${i.toString().padStart(3, '0')}`, { assertionMode: 'llm-judge' }),
    );
    setupChat({ nodes });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa' } }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('cost-cap-exceeded');
    expect(body.estimatedCost.amount).toBeGreaterThan(0.10);
  });

  it('cost-cap acknowledged: proceeds past the cap', async () => {
    // Same 25-fixture setup, but acknowledged.
    const nodes = Array.from({ length: 25 }, (_, i) =>
      fixtureNode(`fixtures:${i.toString().padStart(3, '0')}`, { assertionMode: 'llm-judge' }),
    );
    setupChat({ nodes });
    // Mock 25 turn pairs.
    for (let i = 0; i < 25; i++) {
      mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: 'welcome', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null });
      mockRunChatTurn.mockResolvedValueOnce({ assistantMessage: 'reply', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null });
      mockJudgeAgentReply.mockResolvedValueOnce({ score: 0.9, rationale: 'good' });
    }
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', costCapAcknowledged: true } }));
    expect(res.status).toBe(200);
  });

  it('404 when the agent is not a member', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORGANIZATIONS_QUERY) return { organizations: { items: [], total: 0 } };
      throw new Error('unexpected');
    });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-other' } }));
    expect(res.status).toBe(404);
  });

  it('404 when fixtureLoc points at a non-existent fixture', async () => {
    setupChat({ nodes: [] });
    const POST = await importPOST();
    const res = await POST(ev({ body: { agentId: 'agent-aaa', fixtureLoc: 'fixtures:nope' } }));
    expect(res.status).toBe(404);
  });
});
