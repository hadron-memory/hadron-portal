import { describe, expect, it } from 'vitest';
import { describeInviteLimits, INVITE_EXPIRES_IN_DAYS, INVITE_MAX_ACTIVATIONS } from './invite-limits';

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
