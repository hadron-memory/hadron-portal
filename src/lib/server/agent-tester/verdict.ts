/**
 * #808 — the assertion verdict, and what each value is allowed to claim.
 *
 * `fail` is a claim about the REPLY: the assertion ran, and the reply did not
 * satisfy it. Before this module every error path also returned `fail`, so a
 * worker that never started, a pattern that never compiled and a judge that
 * never answered were all reported as "your agent's reply was wrong". A user
 * reading a red badge concluded their agent had regressed when nothing about
 * the agent had been measured at all.
 *
 * The rule is deliberately a property of the RUN, not an enumeration of
 * failure causes:
 *
 *   pass        — the assertion ran to completion and was satisfied
 *   fail        — the assertion ran to completion and was NOT satisfied
 *   unevaluated — the assertion did not run to completion
 *
 * Enumerating causes is what we are avoiding. Every list of "these error types
 * mean unevaluated" is one type short of the next one somebody adds, and the
 * missing entry lands in the `fail` branch silently. Phrased as a property,
 * `unevaluated` is the catch branch in full and no new error type can be
 * misfiled into a claim about the reply.
 *
 * WHY a cause did not run is carried by `detail`, never by the verdict — the
 * two questions have different audiences. #807 gave the regex path error types
 * that already tell a server problem from a pattern problem; this module is
 * where that distinction becomes readable text.
 */
import { RegexInvalidError, RegexTimeoutError, RegexUnavailableError } from '$lib/server/safe-regex';

// The union itself lives in `$lib/agent-tester/verdict-types` so the RENDERERS
// can import it too — they cannot reach into `$lib/server`, and before that
// module each of them redeclared it as a string literal the compiler could not
// connect to this one. Re-exported here so server-side callers have one import.
export type { Verdict, StoredVerdict, DriftVerdict } from '$lib/agent-tester/verdict-types';

/**
 * Explain a regex assertion that did not produce a verdict.
 *
 * Every branch opens with "could not be evaluated" because they SHARE a
 * verdict: a sentence covering several states has to be true of all of them
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`).
 * What varies after the
 * dash is only what we observed, never what we concluded — in particular this
 * no longer tells the caller their pattern is fine. A pattern pathological
 * enough to exhaust the worker exits non-zero and arrives here as
 * `RegexUnavailableError`, so "this is not a problem with your pattern" (the
 * #807 wording) had a reachable counterexample.
 *
 * Shared by both evaluators on purpose. They were written separately and drifted:
 * fixtures/run never learned about `RegexUnavailableError` at all, so a failed
 * worker there surfaced a raw internal message under a `fail` verdict.
 */
export function describeRegexFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof RegexTimeoutError) {
    return 'regex could not be evaluated — the match did not finish within its time budget';
  }
  if (e instanceof RegexUnavailableError) {
    return `regex could not be evaluated — the worker did not return a result (${msg}). Retry.`;
  }
  if (e instanceof RegexInvalidError) {
    return `regex could not be evaluated — the pattern did not compile (${msg})`;
  }
  return `regex could not be evaluated — ${msg}`;
}
