import { describe, it, expect } from 'vitest';
import {
  testRegexSafely,
  RegexTimeoutError,
  RegexInvalidError,
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
