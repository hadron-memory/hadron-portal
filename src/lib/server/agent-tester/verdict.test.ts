/**
 * #808 — the shared "why did this not evaluate" description.
 *
 * These pin two things the two evaluators kept getting wrong separately: every
 * branch WITHHOLDS rather than claims, and none of them blames the caller's
 * pattern.
 */
import { describe, expect, it } from 'vitest';
import { describeRegexFailure } from './verdict';
import { RegexInvalidError, RegexTimeoutError, RegexUnavailableError } from '$lib/server/safe-regex';

describe('describeRegexFailure', () => {
  const cases: Array<[string, unknown]> = [
    ['timeout', new RegexTimeoutError('regex evaluation timed out')],
    ['unavailable', new RegexUnavailableError('regex worker did not start within 5000ms')],
    ['invalid', new RegexInvalidError('Unterminated group')],
    ['unknown', new Error('something else entirely')],
    ['non-Error', 'a bare string'],
  ];

  it.each(cases)('%s: withholds rather than claiming the reply lost', (_name, err) => {
    const detail = describeRegexFailure(err);
    // A sentence shared by several states has to be true of all of them.
    expect(detail).toContain('could not be evaluated');
    // None of these may read as a statement about the reply.
    expect(detail).not.toMatch(/did not match|did not contain/);
  });

  it('never rules the caller\'s pattern out', () => {
    // #807 said "This is not a problem with your pattern" on the unavailable
    // branch. A pattern pathological enough to kill the worker exits non-zero
    // and arrives as exactly this error, so the claim had a reachable
    // counterexample — the reason the wording is gone rather than reworded.
    for (const [, err] of cases) {
      expect(describeRegexFailure(err)).not.toMatch(/not a problem with your pattern/i);
    }
  });

  it('still distinguishes the causes, which is what #807 added the types for', () => {
    // Withholding a VERDICT is not the same as withholding information. A user
    // needs to tell "retry, the host was busy" from "your pattern is expensive".
    const timeout = describeRegexFailure(new RegexTimeoutError('x'));
    const unavailable = describeRegexFailure(new RegexUnavailableError('worker exited with code 1'));
    expect(timeout).not.toBe(unavailable);
    expect(timeout).toMatch(/time budget/);
    expect(unavailable).toMatch(/worker did not return a result/);
    // The underlying message survives — it is what says WHICH worker failure.
    expect(unavailable).toContain('worker exited with code 1');
  });
});
