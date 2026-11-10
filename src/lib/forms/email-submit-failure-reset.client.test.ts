/**
 * portal#1532 item 3 (Gabriel P3 3): Turnstile's token verifies once (#1470),
 * so the shared helper must ask for a fresh check after EVERY answered submit:
 * an applied result (onUpdated) and a non-result (onError). Dropping either
 * call used to pass the whole suite.
 */
import { describe, expect, it, vi } from 'vitest';
import { emailSubmitFailure } from './email-submit-failure.svelte';

describe('emailSubmitFailure resets the bot check after every answered submit', () => {
  it('on an applied result (onUpdated)', () => {
    const resetCheck = vi.fn();
    emailSubmitFailure({ providers: [], resetCheck }).onUpdated();
    expect(resetCheck).toHaveBeenCalledTimes(1);
  });

  it('on a submit with no ActionResult (onError)', () => {
    const resetCheck = vi.fn();
    emailSubmitFailure({ providers: [], resetCheck }).onError({ result: { type: 'error', error: new TypeError('Failed to fetch') } } as never);
    expect(resetCheck).toHaveBeenCalledTimes(1);
  });

  it('control: a new submit only clears the text; it does not reset the check', () => {
    const resetCheck = vi.fn();
    emailSubmitFailure({ providers: [], resetCheck }).onSubmit();
    expect(resetCheck).not.toHaveBeenCalled();
  });
});
