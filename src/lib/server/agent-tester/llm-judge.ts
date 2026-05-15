/**
 * Spec 019 — LLM-judge evaluator for the Tester's `llm-judge` assertion mode.
 *
 * Given a chatbot reply + a criterion, asks the agent's configured LLM
 * to return a JSON `{ score: 0..1, rationale: string }` verdict. The
 * caller compares `score` against a user-supplied threshold.
 *
 * Provider-agnostic: reuses the agent's LLM config (no separate judge
 * model column in v1, per spec 019 A-3). Uses `generateText` directly
 * rather than `callAgentChatLlm` — the judge wants free-form text, not
 * a `respond` tool call.
 *
 * Single-shot, no retry: if the model returns non-JSON, the verdict
 * surfaces as `{ score: null, rationale: "judge unreachable …" }` so
 * the caller can render an explicit fail (not silent pass).
 */
import { generateText } from 'ai';
import { fetchAgentAIConfig } from '$lib/server/llm/agentChatTurn.js';
import { createLanguageModel } from '$lib/server/llm/agentChatLlm.js';

export interface JudgeResult {
  /** 0..1 inclusive; null if the judge couldn't be reached or returned non-JSON. */
  score: number | null;
  /** One-sentence rationale; "judge unreachable …" if the call failed. */
  rationale: string;
}

const JUDGE_SYSTEM = `You are a strict evaluator. Given a chatbot reply and a criterion, respond with ONLY a JSON object of the form:
{"score": <number 0..1>, "rationale": "<one short sentence>"}
- score 1.0 = the reply clearly satisfies the criterion
- score 0.0 = the reply clearly fails the criterion
- intermediate values for ambiguous cases
Return nothing else — no preamble, no markdown.`;

function buildJudgeUserMessage(reply: string, criterion: string): string {
  return `Reply:\n<<<\n${reply}\n>>>\n\nCriterion:\n<<<\n${criterion}\n>>>`;
}

/**
 * Find the first balanced top-level `{...}` block in a string. Skips
 * braces inside string literals (so `"contains \\\"{\\\""` doesn't
 * throw off the depth counter). Returns the substring including
 * braces, or null.
 *
 * Replaces a previous greedy `\{[\s\S]*\}` regex that over-captured
 * across multiple JSON-like objects + intervening prose. (Raised in
 * PR #217 review.)
 */
export function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

/**
 * Parse a model response. The model is instructed to return ONLY JSON,
 * but real models frequently wrap it in fences or add preamble. Strip
 * common wrappers and parse defensively.
 */
export function parseJudgeResponse(raw: string): JudgeResult {
  let text = raw.trim();

  // Strip Markdown code fences (```json ... ``` or ``` ... ```).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Extract the first balanced JSON object. Falls back to the raw
  // text if no balanced block is found (covers the clean-JSON path).
  const extracted = extractFirstJsonObject(text);
  if (extracted) text = extracted;

  try {
    const parsed = JSON.parse(text) as { score?: unknown; rationale?: unknown };
    const rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : '';
    if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) {
      return { score: null, rationale: 'judge unreachable (no numeric score)' };
    }
    const score = Math.min(1, Math.max(0, parsed.score));
    return { score, rationale: rationale || '(no rationale)' };
  } catch {
    return { score: null, rationale: 'judge unreachable (non-JSON response)' };
  }
}

export interface JudgeAgentReplyArgs {
  token: string | null;
  agentId: string;
  reply: string;
  criterion: string;
}

/**
 * Run the LLM-judge against a captured reply.
 *
 * Returns a JudgeResult. Never throws — provider/network failures
 * surface as `{ score: null, rationale: "judge unreachable …" }` so
 * the caller can render a fail-open verdict.
 */
export async function judgeAgentReply(args: JudgeAgentReplyArgs): Promise<JudgeResult> {
  const { token, agentId, reply, criterion } = args;
  try {
    const ai = await fetchAgentAIConfig(token, agentId);
    const model = createLanguageModel(ai.provider, ai.apiKey, ai.model);
    if (!model) {
      return { score: null, rationale: `judge unreachable (unsupported provider ${ai.provider})` };
    }
    const result = await generateText({
      model,
      system: JUDGE_SYSTEM,
      prompt: buildJudgeUserMessage(reply, criterion),
    });
    return parseJudgeResponse(result.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return { score: null, rationale: `judge unreachable (${msg})` };
  }
}

/**
 * Apply the user's threshold to a judge score.
 *
 * - `score >= threshold` → pass
 * - `score === null` → fail with the flagged rationale (don't silently pass
 *   on a judge failure — surface it so the user investigates)
 */
export function judgeVerdict(
  result: JudgeResult,
  threshold: number,
): { verdict: 'pass' | 'fail'; detail: string } {
  if (result.score === null) {
    return { verdict: 'fail', detail: result.rationale };
  }
  const pass = result.score >= threshold;
  return {
    verdict: pass ? 'pass' : 'fail',
    detail: `score=${result.score.toFixed(2)} ${pass ? '≥' : '<'} ${threshold.toFixed(2)} — ${result.rationale}`,
  };
}
