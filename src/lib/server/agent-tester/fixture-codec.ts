/**
 * Spec 019 — Fixture codec.
 *
 * Single source of truth between (a) the application-level
 * `FixtureRecord` shape and (b) the JSON we store in a memory node's
 * `data` field. Per data-model.md, fixtures are `system`-type nodes
 * at `loc = "fixtures:<id>"` under the agent's system memory.
 *
 * v1 schema (see data-model.md §"Fixture node shape"):
 *
 * {
 *   "version": 1,
 *   "label": "string",
 *   "turns": [Turn],          // length 1 in v1
 *   "createdAt": "ISO",
 *   "updatedAt": "ISO"
 * }
 *
 * v2 will allow `turns.length > 1`. The codec is built around a
 * `turns` list from day one so multi-turn extensions don't require
 * a stored-data migration (FR-016 / Q2 = C).
 */

import type { StoredVerdict } from '$lib/agent-tester/verdict-types';

export type Assertion =
  | { mode: 'literal-contains'; value: string }
  | { mode: 'regex'; pattern: string; flags: string }
  | { mode: 'llm-judge'; criterion: string; threshold: number };

export interface RouteTrace {
  conversationLoc: string | null;
  stageLoc: string | null;
  personaName: string | null;
  routeCandidates?: Array<{ conversationLoc: string; rejected: boolean; reason?: string }>;
}

export interface Turn {
  user: string;
  persona: string | null;
  assertion: Assertion | null;
  capturedReply: string | null;
  capturedRoute: RouteTrace | null;
  /**
   * #808 note: the runtime `Verdict` union gained `unevaluated`, and this
   * STORED type deliberately did not. A baseline is what the fixture is
   * expected to do; "the assertion did not run" is not an expectation, so it
   * has no persisted form. `null` here means no verdict was captured, which is
   * a different fact (no run yet / probe-only) and stays that way.
   */
  capturedVerdict: StoredVerdict;
  capturedAt: string | null;
}

export interface FixtureRecord {
  version: 1;
  label: string;
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
}

export interface RunResult {
  reply: string;
  route: RouteTrace;
  verdict: StoredVerdict;
}

export interface NewFixtureInput {
  label: string;
  turn: Pick<Turn, 'user' | 'persona' | 'assertion'>;
  capture?: RunResult | null;
}

// ── Validation ──────────────────────────────────────────────────────────────

export class FixtureValidationError extends Error {}

function ensureLabel(label: string): void {
  const trimmed = label?.trim() ?? '';
  if (!trimmed) throw new FixtureValidationError('label is required');
  if (trimmed.length > 80) throw new FixtureValidationError('label must be 80 characters or fewer');
}

function ensureTurn(turn: NewFixtureInput['turn']): void {
  if (!turn || typeof turn.user !== 'string' || !turn.user.trim()) {
    throw new FixtureValidationError('turn.user must be a non-empty string');
  }
  if (turn.assertion) ensureAssertion(turn.assertion);
}

function ensureAssertion(a: Assertion): void {
  switch (a.mode) {
    case 'literal-contains':
      if (typeof a.value !== 'string' || a.value === '') {
        throw new FixtureValidationError('literal-contains.value must be a non-empty string');
      }
      return;
    case 'regex':
      if (typeof a.pattern !== 'string' || a.pattern === '') {
        throw new FixtureValidationError('regex.pattern must be a non-empty string');
      }
      try { new RegExp(a.pattern, a.flags ?? ''); }
      catch (e) {
        throw new FixtureValidationError(`regex.pattern invalid: ${e instanceof Error ? e.message : 'unknown'}`);
      }
      return;
    case 'llm-judge':
      if (typeof a.criterion !== 'string' || !a.criterion.trim()) {
        throw new FixtureValidationError('llm-judge.criterion must be a non-empty string');
      }
      if (typeof a.threshold !== 'number' || a.threshold < 0 || a.threshold > 1) {
        throw new FixtureValidationError('llm-judge.threshold must be between 0 and 1');
      }
      return;
    default: {
      const tag = (a as { mode: string }).mode;
      throw new FixtureValidationError(`unknown assertion mode "${tag}"`);
    }
  }
}

// ── Builders / mutators ─────────────────────────────────────────────────────

export function newFixtureRecord(input: NewFixtureInput): FixtureRecord {
  ensureLabel(input.label);
  ensureTurn(input.turn);
  const now = new Date().toISOString();
  return {
    version: 1,
    label: input.label.trim(),
    turns: [{
      user: input.turn.user.trim(),
      persona: input.turn.persona ?? null,
      assertion: input.turn.assertion ?? null,
      capturedReply: input.capture?.reply ?? null,
      capturedRoute: input.capture?.route ?? null,
      capturedVerdict: input.capture?.verdict ?? null,
      capturedAt: input.capture ? now : null,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Apply a fresh run result to a fixture. v1 only mutates the first
 * turn; v2 will accept a per-turn result list.
 */
export function applyRunResult(record: FixtureRecord, result: RunResult): FixtureRecord {
  const now = new Date().toISOString();
  const updatedTurns: Turn[] = record.turns.map((t, i) => i === 0 ? {
    ...t,
    capturedReply: result.reply,
    capturedRoute: result.route,
    capturedVerdict: result.verdict,
    capturedAt: now,
  } : t);
  return { ...record, turns: updatedTurns, updatedAt: now };
}

// ── Codec ───────────────────────────────────────────────────────────────────

/**
 * Serialize a FixtureRecord to the JSON-able shape we store in the
 * node `data` field. Identity for v1 — kept as a function so v2's
 * schema migration has a single integration point.
 */
export function encodeFixture(record: FixtureRecord): unknown {
  return {
    version: record.version,
    label: record.label,
    turns: record.turns,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Decode the node `data` field back to a FixtureRecord, or `null` if
 * the input is malformed. Malformed fixtures should NOT crash the
 * page — the list view surfaces them with an inline error tile.
 */
export function decodeFixture(data: unknown): FixtureRecord | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return null;
  if (typeof d.label !== 'string' || !d.label) return null;
  if (!Array.isArray(d.turns) || d.turns.length === 0) return null;

  const decodedTurns: Turn[] = [];
  for (const t of d.turns as unknown[]) {
    if (!t || typeof t !== 'object') return null;
    const tt = t as Record<string, unknown>;
    if (typeof tt.user !== 'string') return null;
    // assertion may be null or an Assertion-shaped object. We trust
    // the shape rather than re-validate (a malformed shape will fail
    // later on use; that's preferable to silently losing the
    // fixture in the list view).
    decodedTurns.push({
      user: tt.user,
      persona: typeof tt.persona === 'string' ? tt.persona : null,
      assertion: (tt.assertion ?? null) as Assertion | null,
      capturedReply: typeof tt.capturedReply === 'string' ? tt.capturedReply : null,
      capturedRoute: (tt.capturedRoute ?? null) as RouteTrace | null,
      capturedVerdict: (tt.capturedVerdict === 'pass' || tt.capturedVerdict === 'fail')
        ? tt.capturedVerdict
        : null,
      capturedAt: typeof tt.capturedAt === 'string' ? tt.capturedAt : null,
    });
  }

  return {
    version: 1,
    label: d.label,
    turns: decodedTurns,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(0).toISOString(),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(0).toISOString(),
  };
}

/** Summary shape returned to the page / list endpoints. */
export interface FixtureSummary {
  id: string;
  loc: string;
  label: string;
  hasBaseline: boolean;
  capturedVerdict: StoredVerdict;
  capturedAt: string | null;
  assertionMode: 'literal-contains' | 'regex' | 'llm-judge' | null;
  updatedAt: string;
}

export function summarize(loc: string, id: string, record: FixtureRecord): FixtureSummary {
  const first = record.turns[0];
  return {
    id,
    loc,
    label: record.label,
    hasBaseline: first.capturedAt !== null,
    capturedVerdict: first.capturedVerdict,
    capturedAt: first.capturedAt,
    assertionMode: first.assertion?.mode ?? null,
    updatedAt: record.updatedAt,
  };
}
