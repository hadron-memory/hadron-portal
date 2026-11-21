/**
 * portal#1536 items 1, 2, 6, 7: the pure half of the email submit-failure
 * helper: the offline classifier, the provider-list copy and its arities.
 */
import { describe, expect, it } from 'vitest';
import { emailSubmitFailureText, isOfflineFailure, submitFailure } from './email-submit-failure.svelte';
import { emailSignInStrings } from '$lib/i18n/email-sign-in-strings';
import { inviteStrings } from '$lib/i18n/invite-strings';

describe('isOfflineFailure (portal#1536 items 1 and 2)', () => {
  it('a rejected fetch (TypeError) is offline', () => {
    expect(isOfflineFailure({ result: { type: 'error', error: new TypeError('Failed to fetch') } })).toBe(true);
  });

  it('an unknown shape is NOT offline: the unknown case must not claim a connection problem', () => {
    for (const unknown of [undefined, null, {}, { result: {} }, { result: { type: 'error', error: 'x' } }]) {
      expect(isOfflineFailure(unknown)).toBe(false);
    }
  });

  it('a non-JSON body (SyntaxError) is not offline', () => {
    expect(isOfflineFailure({ result: { type: 'error', error: new SyntaxError('Unexpected token <') } })).toBe(false);
  });

  // Trade-off, stated rather than hidden (item 1): kit's `deserialize` of a
  // `null` JSON body ALSO throws a TypeError ("Cannot read properties of null"),
  // and no field tells it apart from a rejected fetch: fetch's own message
  // differs per engine ("Failed to fetch", "Load failed", "NetworkError…"), so
  // matching it would misfire on a locale or engine we did not list. A wrongly
  // offline hint on that rare malformed answer costs one sentence of advice;
  // a missed hint on a real offline reader costs the advice that matters.
  it('pins the trade-off: a null-body deserialize TypeError classifies as offline', () => {
    const nullBody = (() => {
      try {
        return (null as unknown as { type: string }).type;
      } catch (e) {
        return e;
      }
    })();
    expect(nullBody).toBeInstanceOf(TypeError);
    expect(isOfflineFailure({ result: { type: 'error', error: nullBody } })).toBe(true);
  });
});

describe('emailSubmitFailureText provider list (portal#1536 items 2, 6 and 7)', () => {
  const lead = {
    offline: "Your sign-in link couldn't be sent. Check your connection and try again",
    answered: "Your sign-in link couldn't be sent. Try again in a moment",
  };
  it.each([
    [[], '.'],
    [['Google'], ', or continue with Google.'],
    [['Google', 'GitHub'], ', or continue with Google or GitHub.'],
    [['Google', 'Apple', 'GitHub'], ', or continue with Google, Apple or GitHub.'],
  ] as const)('%j', (providers, tail) => {
    expect(emailSubmitFailureText(providers, true)).toBe(lead.offline + tail);
    expect(emailSubmitFailureText(providers, false)).toBe(lead.answered + tail);
  });
});

describe('providerList owns the whole list format (portal#1536 item 6)', () => {
  it.each([
    [['Google', 'GitHub'], 'Google or GitHub'],
    [['Google', 'Apple', 'GitHub'], 'Google, Apple or GitHub'],
    [['A', 'B', 'C', 'D'], 'A, B, C or D'],
  ])('%j', (names, expected) => {
    expect(emailSignInStrings.providerList(names)).toBe(expected);
  });
});

describe('invite strings (portal#1536 item 5)', () => {
  it('the accept-failure copy lives in the invite module, offline and answered', () => {
    expect(inviteStrings.acceptFailure(true)).toBe("Your invitation couldn't be accepted. Check your connection and try again.");
    expect(inviteStrings.acceptFailure(false)).toBe("Your invitation couldn't be accepted. Try again in a moment.");
  });
});

describe('submitFailure.onSubmit clears the text (portal#1536 item 7)', () => {
  it('a failure shows, and the next submit takes it away before its own answer', () => {
    const f = submitFailure({ text: (offline) => (offline ? 'offline' : 'answered') });
    expect(f.text).toBeNull();
    f.onError({ result: { type: 'error', error: new TypeError('x') } });
    expect(f.text).toBe('offline');
    f.onSubmit();
    expect(f.text).toBeNull();
  });
});
