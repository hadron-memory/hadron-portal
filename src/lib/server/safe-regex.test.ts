import { describe, it, expect } from 'vitest';
import {
  testRegexSafely,
  RegexTimeoutError,
  RegexInvalidError,
  RegexUnavailableError,
  MAX_PATTERN_LEN,
} from './safe-regex';

describe('testRegexSafely', () => {
  it('returns true/false for ordinary patterns', async () => {
    expect(await testRegexSafely('^hello', '', 'hello world')).toBe(true);
    expect(await testRegexSafely('^world', '', 'hello world')).toBe(false);
    expect(await testRegexSafely('DONE', 'i', 'the task is done')).toBe(true);
  });

  it('terminates a catastrophic-backtracking pattern instead of hanging', async () => {
    // (a+)+$ against a run of `a`s ending in a non-match blows up exponentially
    // in V8's engine; the worker must be killed at the timeout.
    const evil = '(a+)+$';
    const input = 'a'.repeat(40) + 'b';
    const started = Date.now();
    await expect(testRegexSafely(evil, '', input, 100)).rejects.toBeInstanceOf(RegexTimeoutError);
    // Should be bounded near the timeout, not run for seconds.
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);

  it('rejects an over-long pattern before running', async () => {
    await expect(
      testRegexSafely('a'.repeat(MAX_PATTERN_LEN + 1), '', 'aaa'),
    ).rejects.toBeInstanceOf(RegexInvalidError);
  });

  it('surfaces an invalid pattern as RegexInvalidError', async () => {
    await expect(testRegexSafely('(', '', 'x')).rejects.toBeInstanceOf(RegexInvalidError);
  });

  it('accepts valid flags and rejects invalid/over-long flags', async () => {
    expect(await testRegexSafely('abc', 'i', 'ABC')).toBe(true);
    await expect(testRegexSafely('abc', 'zzz', 'abc')).rejects.toBeInstanceOf(RegexInvalidError);
    await expect(testRegexSafely('abc', 'g'.repeat(20), 'abc')).rejects.toBeInstanceOf(RegexInvalidError);
  });
});

/**
 * #800 — the timeout must bound the MATCH, not the thread spawn.
 *
 * The flake that surfaced this reported `^Hi` as "evaluation timed out (pattern
 * too complex)" after 114ms, against a 100ms budget. Measured on an idle
 * machine, a trivial pattern through this helper costs ~14-16ms and a bare
 * Worker spawn with an empty script costs ~15-16ms — so the budget was almost
 * entirely spent on startup, and a loaded host exceeds it without the pattern
 * doing anything at all.
 */
describe('the budget bounds matching, not worker startup (#800)', () => {
  /**
   * The discriminating test. 5ms is FAR below the ~15ms it takes to spawn the
   * thread, so under the old code — where the clock started at `new Worker(...)`
   * — this could only ever time out. It passes now because the clock starts when
   * the worker signals ready, and `^Hi` then matches in microseconds.
   */
  it('a trivial pattern succeeds even when the budget is smaller than spawn cost', async () => {
    expect(await testRegexSafely('^Hi', '', 'Hi there!', 5)).toBe(true);
    expect(await testRegexSafely('^Goodbye', '', 'Hi there!', 5)).toBe(false);
  }, 10000);

  /**
   * The other direction, and the one that matters for the mitigation being
   * real: moving the clock must not make a catastrophic pattern un-catchable.
   * It cannot, because `ready` is posted BEFORE the pattern is compiled — but
   * that is an assumption about message delivery from a thread that is about to
   * block, so it is asserted rather than reasoned about.
   */
  it('still terminates a catastrophic pattern once matching has started', async () => {
    const started = Date.now();
    await expect(
      testRegexSafely('(a+)+$', '', 'a'.repeat(40) + 'b', 50),
    ).rejects.toBeInstanceOf(RegexTimeoutError);
    // Bounded by startup + the match budget, nowhere near STARTUP_TIMEOUT_MS.
    expect(Date.now() - started).toBeLessThan(2000);
  }, 10000);

  /**
   * A startup failure is a statement about the SERVER, a match timeout is a
   * statement about the CALLER'S PATTERN. The endpoint renders the latter as
   * "pattern too complex", so returning that type for a busy host is what told
   * a user their `^Hi` was the problem.
   */
  it('distinguishes "could not start" from "pattern too slow" by error type', async () => {
    // A 0ms startup budget cannot be met by any thread.
    await expect(
      testRegexSafely('^Hi', '', 'Hi there!', 100, 0),
    ).rejects.toBeInstanceOf(RegexUnavailableError);
    // ...and that is NOT the type the endpoint blames the pattern for.
    await expect(
      testRegexSafely('^Hi', '', 'Hi there!', 100, 0),
    ).rejects.not.toBeInstanceOf(RegexTimeoutError);
  }, 10000);
});
