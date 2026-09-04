/**
 * Spec 019 T016 — Unit tests for the LLM-judge evaluator.
 *
 * Covers `parseJudgeResponse` (deterministic JSON parsing) and
 * `judgeVerdict` (threshold logic). `judgeAgentReply` itself depends on
 * a live LLM and is exercised by the eval fixture set in
 * `llm-judge-eval.fixtures.ts` (T017) under an integration suite.
 *
 * Importing `./llm-judge` transitively pulls in SvelteKit's
 * `$env/dynamic/private` (via `agentChatTurn.ts → api.ts`). Vitest
 * can't resolve that outside the SvelteKit runtime, so we stub the
 * intermediate modules even though the tests below only exercise the
 * pure helpers.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: vi.fn() }),
}));

vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  fetchAgentAIConfig: vi.fn(),
}));

vi.mock('$lib/server/llm/agentChatLlm.js', () => ({
  createLanguageModel: vi.fn(),
}));

const { parseJudgeResponse, judgeVerdict, extractFirstJsonObject } = await import('./llm-judge');

describe('extractFirstJsonObject — bracket-balanced extraction', () => {
  it('returns null when no braces are present', () => {
    expect(extractFirstJsonObject('plain text')).toBeNull();
  });

  it('extracts the first balanced object', () => {
    expect(extractFirstJsonObject('preamble {"a": 1} trailer')).toBe('{"a": 1}');
  });

  it('does not over-capture across two objects (regression — was broken with greedy regex)', () => {
    const input = 'first thought: {"score": 0.2, "rationale": "low"} then I reconsidered: {"score": 0.9, "rationale": "high"}';
    expect(extractFirstJsonObject(input)).toBe('{"score": 0.2, "rationale": "low"}');
  });

  it('ignores braces inside string literals', () => {
    const input = '{"rationale": "the bot literally said \\"{\\""}';
    expect(extractFirstJsonObject(input)).toBe(input);
  });

  it('handles nested objects', () => {
    expect(extractFirstJsonObject('{"score": 0.5, "meta": {"k": "v"}}'))
      .toBe('{"score": 0.5, "meta": {"k": "v"}}');
  });
});

describe('parseJudgeResponse', () => {
  it('parses a bare JSON object', () => {
    const r = parseJudgeResponse('{"score": 0.85, "rationale": "good"}');
    expect(r.score).toBe(0.85);
    expect(r.rationale).toBe('good');
  });

  it('parses JSON wrapped in a markdown code fence', () => {
    const r = parseJudgeResponse('```json\n{"score": 0.5, "rationale": "ok"}\n```');
    expect(r.score).toBe(0.5);
    expect(r.rationale).toBe('ok');
  });

  it('parses JSON with a leading preamble', () => {
    const r = parseJudgeResponse('Sure, here is the eval: {"score": 1, "rationale": "perfect"}');
    expect(r.score).toBe(1);
    expect(r.rationale).toBe('perfect');
  });

  it('clamps scores outside [0, 1]', () => {
    expect(parseJudgeResponse('{"score": 1.5, "rationale": "x"}').score).toBe(1);
    expect(parseJudgeResponse('{"score": -0.2, "rationale": "x"}').score).toBe(0);
  });

  it('surfaces a non-JSON response as a judge-unreachable result', () => {
    const r = parseJudgeResponse('I cannot evaluate this without more context.');
    expect(r.score).toBeNull();
    expect(r.rationale).toMatch(/judge unreachable/);
  });

  it('surfaces a JSON-without-numeric-score response as judge-unreachable', () => {
    const r = parseJudgeResponse('{"score": "high", "rationale": "good"}');
    expect(r.score).toBeNull();
    expect(r.rationale).toMatch(/no numeric score/);
  });

  it('handles missing rationale by defaulting to a placeholder', () => {
    const r = parseJudgeResponse('{"score": 0.4}');
    expect(r.score).toBe(0.4);
    expect(r.rationale).toBe('(no rationale)');
  });

  it('picks the first balanced object when the model emits two (was broken pre-PR-217-review)', () => {
    const r = parseJudgeResponse('thought 1: {"score": 0.2, "rationale": "low"} thought 2: {"score": 0.9, "rationale": "high"}');
    expect(r.score).toBe(0.2);
    expect(r.rationale).toBe('low');
  });
});

describe('judgeVerdict', () => {
  it('passes when score >= threshold', () => {
    const v = judgeVerdict({ score: 0.7, rationale: 'r' }, 0.7);
    expect(v.verdict).toBe('pass');
    expect(v.detail).toContain('0.70 ≥ 0.70');
  });

  it('fails when score < threshold', () => {
    const v = judgeVerdict({ score: 0.5, rationale: 'r' }, 0.8);
    expect(v.verdict).toBe('fail');
    expect(v.detail).toContain('0.50 < 0.80');
  });

  it('boundary: score exactly at threshold passes', () => {
    expect(judgeVerdict({ score: 0.5, rationale: 'x' }, 0.5).verdict).toBe('pass');
  });

  // #808: a null score means no judge answer arrived, so there is nothing to
  // compare against the threshold. This used to return `fail` — which does not
  // silently pass, and that part was right, but it told the user their reply
  // had been judged and found wanting when it had never been judged at all.
  it('judge-unreachable is unevaluated: neither a pass nor a claim about the reply', () => {
    const v = judgeVerdict({ score: null, rationale: 'judge unreachable (timeout)' }, 0.7);
    expect(v.verdict).toBe('unevaluated');
    expect(v.verdict).not.toBe('pass'); // the original fail-open guarantee, kept
    expect(v.detail).toMatch(/judge unreachable/);
  });

  it('a scored miss is still a plain fail', () => {
    // Pins the other direction: `unevaluated` must not absorb real failures.
    // A judge that answered and scored below threshold HAS judged the reply.
    expect(judgeVerdict({ score: 0.1, rationale: 'r' }, 0.9).verdict).toBe('fail');
  });
});
