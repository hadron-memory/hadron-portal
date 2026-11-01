import { describe, expect, it } from 'vitest';
import { describeInviteLimits, INVITE_EXPIRES_IN_DAYS, INVITE_MAX_ACTIVATIONS } from './invite-limits';
import { CREATE_USER_INVITATION_MUTATION, INVITE_USER_MUTATION } from '$lib/server/queries';

describe('invite limits (V49)', () => {
  it('sends values inside the V49 ranges (1-10 days, 2-1000 uses)', () => {
    expect(INVITE_EXPIRES_IN_DAYS).toBeGreaterThanOrEqual(1);
    expect(INVITE_EXPIRES_IN_DAYS).toBeLessThanOrEqual(10);
    expect(INVITE_MAX_ACTIVATIONS).toBeGreaterThanOrEqual(2);
    expect(INVITE_MAX_ACTIVATIONS).toBeLessThanOrEqual(1000);
  });
  it('describes the returned values, not a hard-coded promise', () => {
    expect(describeInviteLimits({ expiresAt: '2026-11-12T12:00:00.000Z', maxActivations: 5 }))
      .toBe('Expires Nov 12, 2026; can be used 5 times.');
    expect(describeInviteLimits({ expiresAt: '2026-11-12T12:00:00.000Z', maxActivations: 1 }))
      .toBe('Expires Nov 12, 2026; can be used 1 time.');
  });
  it('reads null fields as no limit', () => {
    expect(describeInviteLimits({ expiresAt: null, maxActivations: null }))
      .toBe('Does not expire; has no use limit.');
  });
});

// The success copy reads these fields off the mutation result. A transport-
// stubbed action test cannot notice a dropped field (the stub returns whatever
// it is given), and a missing one would render "Does not expire; has no use
// limit." - the false promise #1592 removes. Pin the documents themselves.
describe('invite mutation documents select the returned limits', () => {
  function selectionOf(doc: string, field: string): string {
    const start = doc.indexOf(`${field}(`);
    expect(start).toBeGreaterThan(-1);
    // Selection set = the first `{ ... }` after the argument list closes.
    const open = doc.indexOf('{', doc.indexOf(')', start));
    return doc.slice(open, doc.indexOf('}', open));
  }
  it('INVITE_USER_MUTATION selects maxActivations and expiresAt', () => {
    const sel = selectionOf(INVITE_USER_MUTATION, 'inviteUser');
    expect(sel).toMatch(/\bmaxActivations\b/);
    expect(sel).toMatch(/\bexpiresAt\b/);
  });
  it('CREATE_USER_INVITATION_MUTATION selects maxActivations and expiresAt', () => {
    const sel = selectionOf(CREATE_USER_INVITATION_MUTATION, 'createUserInvitation');
    expect(sel).toMatch(/\bmaxActivations\b/);
    expect(sel).toMatch(/\bexpiresAt\b/);
  });
});
