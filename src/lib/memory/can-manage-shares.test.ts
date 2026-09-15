/**
 * #668 / @codex P1 on #839 — the share-management display gate.
 *
 * The case that matters is the one that used to render a lie: a caller who is
 * NOT the principal gets `shares: []` from the server (non-null field,
 * unauthorized paths return an empty array), which the page would otherwise
 * show as "not shared with anyone yet" plus a grant form.
 */
import { describe, expect, it } from 'vitest';
import { canManageShares } from './can-manage-shares';

const principal = { userId: 'owner-1' };

describe('canManageShares', () => {
  it('lets the principal manage their own memory', () => {
    expect(canManageShares(principal, { id: 'owner-1' })).toBe(true);
  });

  it('refuses a different signed-in user — the grantee/org-member case', () => {
    // This is the #839 P1: before the gate, this caller saw an empty list
    // rendered as "not shared with anyone yet" and was offered a Share button.
    expect(canManageShares(principal, { id: 'someone-else' })).toBe(false);
  });

  it('lets a platform ADMIN or OWNER through, mirroring the resolver', () => {
    expect(canManageShares(principal, { id: 'x', roles: ['ADMIN'] })).toBe(true);
    expect(canManageShares(principal, { id: 'x', roles: ['OWNER'] })).toBe(true);
  });

  it('does not treat an ordinary role as platform admin', () => {
    expect(canManageShares(principal, { id: 'x', roles: ['USER', 'MEMBER'] })).toBe(false);
  });

  it('refuses when there is no signed-in user', () => {
    expect(canManageShares(principal, null)).toBe(false);
    expect(canManageShares(principal, { id: null })).toBe(false);
    expect(canManageShares(principal, {})).toBe(false);
  });

  it('never matches two NULLS into ownership', () => {
    // An org-owned memory has `userId: null`. A caller with no id must not
    // satisfy `memory.userId === user.id` by both being nullish.
    //
    // Note what actually enforces this: the `!user?.id` early return, not the
    // `!= null` in the comparison. Mutating that `!= null` away leaves these
    // assertions green, so this test documents the BEHAVIOUR and does not
    // prove that particular clause is load-bearing — it is not.
    expect(canManageShares({ userId: null }, { id: null })).toBe(false);
    expect(canManageShares({ userId: null }, { id: undefined })).toBe(false);
    expect(canManageShares({}, {})).toBe(false);
  });

  it('refuses on an org-owned memory for a non-admin, even a signed-in one', () => {
    expect(canManageShares({ userId: null }, { id: 'u-1' })).toBe(false);
  });

  it('refuses a missing memory, platform admin included', () => {
    // No memory means nothing to manage. The admin branch must not run ahead
    // of that check and hand back `true` for an entity that is not there —
    // which is what an earlier draft of this test wrongly asserted.
    expect(canManageShares(null, { id: 'owner-1' })).toBe(false);
    expect(canManageShares(undefined, { id: 'owner-1', roles: ['ADMIN'] })).toBe(false);
  });
});
