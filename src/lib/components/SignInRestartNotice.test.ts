/** portal#1091 — the notice a refused sign-in lands on: fixed text, a restart and the identity-provider way in, no reason. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SignInRestartNotice from './SignInRestartNotice.svelte';

const html = () => render(SignInRestartNotice).body;

describe('SignInRestartNotice', () => {
  it('is announced as an alert', () => {
    expect(html()).toMatch(/role="alert"/);
  });

  it('says the sign-in did not complete and offers both ways forward', () => {
    const body = html();
    expect(body).toContain("That sign-in didn't complete.");
    expect(body).toContain('Start again, or use GitHub, Google or Apple.');
  });

  // The callback refuses for several reasons (a missing, mismatched or expired
  // browser nonce, a used code) and the server tells the portal none of them.
  // The notice must not guess one, and must say nothing about the account or a
  // passkey: either would turn the restart page into an oracle.
  it.each([/passkey/i, /expired/i, /account/i, /browser/i, /nonce/i])('names no reason or account detail (%s)', (re) => {
    expect(html()).not.toMatch(re);
  });
});
