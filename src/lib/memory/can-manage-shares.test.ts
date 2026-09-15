/**
 * #668 / @codex P1 on #839 — the share-management display gate.
 *
 * The case that matters is the one that used to render a lie: a caller who is
 * NOT the principal gets `shares: []` from the server (non-null field,
 * unauthorized paths return an empty array), which the page would otherwise
 * show as "not shared with anyone yet" plus a grant form.
 */
import { describe, expect, it } from 'vitest';
import { canEditShares, canSeeShares, isSharePrincipal } from './can-manage-shares';

const principal = { userId: 'owner-1' };

describe('canSeeShares (read)', () => {
  it('lets the principal manage their own memory', () => {
    expect(canSeeShares(principal, { id: 'owner-1' })).toBe(true);
  });

  it('refuses a different signed-in user — the grantee/org-member case', () => {
    // This is the #839 P1: before the gate, this caller saw an empty list
    // rendered as "not shared with anyone yet" and was offered a Share button.
    expect(canSeeShares(principal, { id: 'someone-else' })).toBe(false);
  });

  it('lets a platform ADMIN or OWNER through, mirroring the resolver', () => {
    expect(canSeeShares(principal, { id: 'x', roles: ['ADMIN'] })).toBe(true);
    expect(canSeeShares(principal, { id: 'x', roles: ['OWNER'] })).toBe(true);
  });

  it('does not treat an ordinary role as platform admin', () => {
    expect(canSeeShares(principal, { id: 'x', roles: ['USER', 'MEMBER'] })).toBe(false);
  });

  it('refuses when there is no signed-in user', () => {
    expect(canSeeShares(principal, null)).toBe(false);
    expect(canSeeShares(principal, { id: null })).toBe(false);
    expect(canSeeShares(principal, {})).toBe(false);
  });

  it('never matches two NULLS into ownership', () => {
    // An org-owned memory has `userId: null`. A caller with no id must not
    // satisfy `memory.userId === user.id` by both being nullish.
    //
    // Note what actually enforces this: the `!user?.id` early return, not the
    // `!= null` in the comparison. Mutating that `!= null` away leaves these
    // assertions green, so this test documents the BEHAVIOUR and does not
    // prove that particular clause is load-bearing — it is not.
    expect(canSeeShares({ userId: null }, { id: null })).toBe(false);
    expect(canSeeShares({ userId: null }, { id: undefined })).toBe(false);
    expect(canSeeShares({}, {})).toBe(false);
  });

  it('refuses on an org-owned memory for a non-admin, even a signed-in one', () => {
    expect(canSeeShares({ userId: null }, { id: 'u-1' })).toBe(false);
  });

  it('refuses a missing memory, platform admin included', () => {
    // No memory means nothing to manage. The admin branch must not run ahead
    // of that check and hand back `true` for an entity that is not there —
    // which is what an earlier draft of this test wrongly asserted.
    expect(canSeeShares(null, { id: 'owner-1' })).toBe(false);
    expect(canSeeShares(undefined, { id: 'owner-1', roles: ['ADMIN'] })).toBe(false);
  });
});

describe('canEditShares (write) — principal only', () => {
  // @copilot on #839: every share MUTATION goes through
  // `requireMemorySharePrincipal` → `memory.userId === ctx.userId`, with NO
  // platform-admin bypass. Read and write are different gates, and conflating
  // them offered an admin controls whose every submission is FORBIDDEN.
  it('lets the principal edit', () => {
    expect(canEditShares(principal, { id: 'owner-1' })).toBe(true);
  });

  it('refuses a platform admin, who may still SEE the list', () => {
    const admin = { id: 'x', roles: ['ADMIN'] };
    expect(canSeeShares(principal, admin)).toBe(true);
    expect(canEditShares(principal, admin)).toBe(false);
  });

  it('refuses everyone else', () => {
    expect(canEditShares(principal, { id: 'someone-else' })).toBe(false);
    expect(canEditShares(principal, null)).toBe(false);
    expect(canEditShares({ userId: null }, { id: null })).toBe(false);
  });

  it('is the same predicate as isSharePrincipal, by construction', () => {
    expect(canEditShares).toBe(isSharePrincipal);
  });
});
