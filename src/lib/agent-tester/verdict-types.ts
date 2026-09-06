/**
 * #808 / #813 — the agent-tester's shared types, in ONE place both sides can import.
 *
 * These live outside `$lib/server` deliberately. The evaluator that produces a
 * verdict is server-only (it reaches for worker threads and the judge LLM), but
 * the components that RENDER one cannot import from `$lib/server` at all — so
 * before this module they each redeclared the union as a string literal, and
 * the compiler had no idea the four declarations were meant to be the same
 * type.
 *
 * That is the defect this issue is about, one level up. Widening
 * `Verdict` used to flag the two endpoints and say nothing about
 * `VerdictBadge`, `DriftReport` or the tester page, whose `else` branches would
 * quietly absorb the new member and keep rendering a claim written for a
 * different state. A shared type is what makes the next widening a compile
 * error in every reader instead of a silent one in three of them
 * (`hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback`).
 *
 * Type-only, so importing it costs the client bundle nothing.
 */

/**
 * What an assertion run is allowed to claim.
 *
 * - `pass` — ran to completion and was satisfied
 * - `fail` — ran to completion and was NOT satisfied; a claim about the REPLY
 * - `unevaluated` — did not run to completion; NOT a claim about the reply
 */
export type Verdict = 'pass' | 'fail' | 'unevaluated';

/**
 * A verdict as it can be STORED on a fixture baseline.
 *
 * Deliberately narrower than `Verdict`: a baseline is what the fixture is
 * expected to do, and "the assertion did not run" is not an expectation, so it
 * has no persisted form. `null` means no verdict was captured — a different
 * fact (never run, or probe-only).
 */
export type StoredVerdict = 'pass' | 'fail' | null;

/**
 * How a replay's verdict compares to its baseline.
 *
 * `unevaluated` is not a drift direction — it says the replay produced no
 * verdict, so whether it drifted is unknown. Keeping it in the same union is
 * what stops it being reported as a fifth kind of change.
 */
export type DriftVerdict =
  | 'still-passing'
  | 'still-failing'
  | 'newly-passing'
  | 'newly-failing'
  | 'no-baseline'
  | 'unevaluated';

/**
 * #813 — the tallies `POST /api/agent-chat/fixtures/run` returns for a run.
 *
 * Shared for the reason this module exists: the page and `RunSummary` each
 * declared their own copy, so the endpoint growing a field would have been a
 * compile error in neither (@copilot on #814's sibling PR). That is the same
 * defect `hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback` describes, one level
 * up from the union it was written about.
 *
 * `unevaluated` is OPTIONAL on purpose: it arrived with #812, and a portal
 * deployed against an older server will not receive it. Absent means "this
 * server does not report it", which is different from zero.
 */
export interface FixtureRunSummary {
  totalRuns: number;
  passed: number;
  failed: number;
  errored: number;
  unevaluated?: number;
  estimatedCost: { currency: string; amount: number };
  exceededCap: boolean;
}
