/**
 * #1979 (live-provider test slice): the ONE bounded matrix, and the closed
 * summary it leaves. Drives the real `callAgentChatLlm` (so the real
 * `createLanguageModel`, schema conversion and forced-tool branch) over
 * synthetic non-customer input only. See `liveProvider.ts` for inputs/meanings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { callAgentChatLlm, type HadronTool } from '$lib/server/llm/agentChatLlm';
import {
  LEDGER_PATH, LIVE_DIR, LIVE_ENV, MAX_REQUESTS, claimMatrixRun, createGuard, fileLedger, redactDiagnostic, resolveGate,
  type GateDecision, type Guard, type Ledger, type Observation, type ProviderErrorType,
} from './liveProvider';

type Msg = { role: 'user' | 'assistant'; content: string };

// Synthetic, non-customer fixtures. No real chat, memory, App or config.
const SYSTEM = 'You are a friendly intake assistant in a synthetic demo. Greet the user and ask one short question.';
const HISTORY: Msg[] = [
  { role: 'user', content: 'Hi, I want to plan a small garden.' },
  { role: 'assistant', content: 'Lovely! What space do you have?' },
  { role: 'user', content: 'A balcony about two meters wide.' },
];
export const SYNTHETIC_RESPOND: HadronTool = {
  name: 'respond',
  description: 'Respond to the user and extract data',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The reply to show the user.' },
      data: { type: 'object', description: 'Extracted fields.', additionalProperties: true },
      next_stage: { type: ['string', 'null'], description: 'Next stage key, or null.' },
    },
    required: ['message'],
  },
};

export interface MatrixCase { id: string; branch: 'respond' | 'plain'; turn: 'welcome' | 'turn'; tools: HadronTool[] | null; messages: Msg[] }
/** (a) welcome+respond, (b) history+respond, (c/d) the plain-branch controls. Order: the suspect first. */
export const MATRIX: readonly MatrixCase[] = [
  { id: 'a-welcome-respond', branch: 'respond', turn: 'welcome', tools: [SYNTHETIC_RESPOND], messages: [] },
  { id: 'b-history-respond', branch: 'respond', turn: 'turn', tools: [SYNTHETIC_RESPOND], messages: HISTORY },
  { id: 'c-welcome-plain', branch: 'plain', turn: 'welcome', tools: null, messages: [] },
  { id: 'd-history-plain', branch: 'plain', turn: 'turn', tools: null, messages: HISTORY },
];

export type CaseOutcome = 'ok' | 'provider-status' | 'request-failed' | 'unexpected-tool-output' | 'gate-stopped' | 'not-run';
export interface CaseResult {
  id: string; branch: string; turn: string;
  outcome: CaseOutcome;
  status: number | null;
  type: ProviderErrorType | 'other' | null;
  requests: number;
}
export interface MatrixResult {
  cases: CaseResult[];
  requestsTotal: number;
  cap: number;
  stoppedBy: 'window-expired' | 'cap-exhausted' | null;
  reproduced400: boolean;
  /** Redacted provider messages: LOCAL file only, never printed or asserted on. */
  localDiagnostics: Array<{ id: string; message: string }>;
}

export interface MatrixDeps {
  realFetch: typeof fetch;
  now: () => number;
  ledger: Ledger;
  max?: number;
  callLlm?: typeof callAgentChatLlm;
}

/** Runs the matrix once. Stops at the first gate stop; the rest are 'not-run'. Never loops, never retries a case. */
export async function runMatrix(
  gate: Extract<GateDecision, { status: 'ready' }>,
  deps: MatrixDeps,
): Promise<MatrixResult> {
  const guard: Guard = createGuard({
    realFetch: deps.realFetch, now: deps.now, windowEndMs: gate.windowEndMs,
    ledger: deps.ledger, apiKey: gate.apiKey, max: deps.max,
  });
  const call = deps.callLlm ?? callAgentChatLlm;
  const cases: CaseResult[] = [];
  const localDiagnostics: Array<{ id: string; message: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = guard.fetch;
  try {
    for (const c of MATRIX) {
      if (guard.stoppedBy()) { cases.push(blank(c, 'not-run')); continue; }
      const sentBefore = guard.sent();
      const seenBefore = guard.observations.length;
      let outcome: CaseOutcome = 'ok';
      try {
        await call({
          provider: 'anthropic', apiKey: gate.apiKey, model: gate.model,
          systemMessage: SYSTEM, tools: c.tools, messages: c.messages,
        });
      } catch {
        // The thrown value is the closed ChatError; the SDK error never reaches us. Classify from our own observations.
        outcome = 'request-failed';
      }
      const seen: Observation[] = guard.observations.slice(seenBefore);
      const last = seen[seen.length - 1];
      if (guard.stoppedBy()) outcome = 'gate-stopped';
      else if (outcome === 'request-failed' && last && last.status >= 100 && !(last.status >= 200 && last.status < 300)) outcome = 'provider-status';
      else if (outcome === 'request-failed' && last) outcome = 'unexpected-tool-output';
      for (const o of seen) if (o.localMessage) localDiagnostics.push({ id: c.id, message: o.localMessage });
      cases.push({
        id: c.id, branch: c.branch, turn: c.turn, outcome,
        status: last ? last.status : null, type: last ? last.type : null,
        requests: guard.sent() - sentBefore,
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    cases, requestsTotal: guard.sent(), cap: deps.max ?? MAX_REQUESTS, stoppedBy: guard.stoppedBy(),
    reproduced400: cases.some((c) => c.status === 400), localDiagnostics,
  };
}

function blank(c: MatrixCase, outcome: CaseOutcome): CaseResult {
  return { id: c.id, branch: c.branch, turn: c.turn, outcome, status: null, type: null, requests: 0 };
}

// ── Provenance + the public summary: closed fields only ──

export function sdkVersions(): { ai: string; anthropic: string } {
  const req = createRequire(import.meta.url);
  const read = (name: string): string => {
    try { return String((req(`${name}/package.json`) as { version?: unknown }).version ?? 'unknown'); } catch { return 'unknown'; }
  };
  return { ai: read('ai'), anthropic: read('@ai-sdk/anthropic') };
}

export function headSha(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

/** The public summary. Built only from closed fields, then passed through the redactor once more as a belt. */
export function formatSummary(args: {
  result: MatrixResult; head: string; model: string; versions: { ai: string; anthropic: string };
  windowStartMs: number; windowEndMs: number; startedMs: number; endedMs: number; apiKey: string;
}): string {
  const { result: r } = args;
  const iso = (ms: number) => new Date(ms).toISOString();
  const lines = [
    `#1979 live-provider matrix: ${r.reproduced400 ? 'REPRODUCED 400' : 'NO 400 REPRODUCED'}`,
    `head=${args.head} model=${args.model} ai=${args.versions.ai} @ai-sdk/anthropic=${args.versions.anthropic}`,
    `window=${iso(args.windowStartMs)}..${iso(args.windowEndMs)} run=${iso(args.startedMs)}..${iso(args.endedMs)}`,
    `requests=${r.requestsTotal}/${r.cap} stoppedBy=${r.stoppedBy ?? 'none'}`,
    ...r.cases.map((c) => `case=${c.id} branch=${c.branch} turn=${c.turn} outcome=${c.outcome} status=${c.status ?? 'none'} type=${c.type ?? 'none'} requests=${c.requests}`),
  ];
  // Key fragments only: the head SHA is a 40-char token that the credential-shape rule would wrongly eat.
  return redactDiagnostic(lines.join('\n'), args.apiKey, { shapes: false });
}

export type LiveRunReport =
  | { ran: false; decision: Exclude<GateDecision, { status: 'ready' }> }
  | { ran: true; summary: string; result: MatrixResult };

/**
 * The whole opted-in entry point. A skipped or refused decision returns BEFORE
 * any provider call or key use. When it runs, the public summary and the
 * redacted local diagnostic go under the gitignored `.live-provider/`.
 */
export async function runLiveFromEnv(env: Record<string, string | undefined>, deps: {
  realFetch: typeof fetch; now?: () => number; ledgerPath?: string; outDir?: string; max?: number; callLlm?: typeof callAgentChatLlm;
}): Promise<LiveRunReport> {
  const now = deps.now ?? Date.now;
  const ledgerPath = deps.ledgerPath ?? LEDGER_PATH;
  const outDir = deps.outDir ?? LIVE_DIR;
  const max = deps.max ?? MAX_REQUESTS;
  // Env checks first: a skip or env refusal must not touch the ledger at all.
  const envDecision = resolveGate(env, now(), 0, max);
  if (envDecision.status !== 'ready') return { ran: false, decision: envDecision };
  let used: number;
  try {
    used = fileLedger(ledgerPath, envDecision.windowStartMs).count();
  } catch {
    // Unknown prior usage: fail closed rather than treating it as zero.
    return { ran: false, decision: { status: 'refused', reason: 'ledger-corrupt' } };
  }
  const decision = resolveGate(env, now(), used, max);
  if (decision.status !== 'ready') return { ran: false, decision };
  // One matrix per window: claim before the first request, refuse re-entry after any run.
  if (!claimMatrixRun(ledgerPath, decision.windowStartMs)) {
    return { ran: false, decision: { status: 'refused', reason: 'matrix-already-run' } };
  }

  const startedMs = now();
  const result = await runMatrix(decision, {
    realFetch: deps.realFetch, now, ledger: fileLedger(ledgerPath, decision.windowStartMs), max, callLlm: deps.callLlm,
  });
  const summary = formatSummary({
    result, head: headSha(), model: decision.model, versions: sdkVersions(),
    windowStartMs: decision.windowStartMs, windowEndMs: decision.windowEndMs, startedMs, endedMs: now(), apiKey: decision.apiKey,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/summary.txt`, `${summary}\n`);
  writeFileSync(`${outDir}/diagnostic.local.json`, JSON.stringify(result.localDiagnostics, null, 2));
  return { ran: true, summary, result };
}
