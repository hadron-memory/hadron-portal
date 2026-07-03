import { describe, expect, it } from 'vitest';
import { filterToMemberOrgs, resolveActiveOrg } from './active-org';
import type { Organization } from '$lib/types';

function makeOrg(overrides: Partial<Organization>): Organization {
  return {
    id: 'org-id',
    name: 'Org',
    urn: 'org:example',
    isVisible: true,
    githubInstallationId: null,
    githubAppId: null,
    hasGithubAppPrivateKey: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveActiveOrg — spec 014 R-1/R-2/R-9', () => {
  const personal = makeOrg({ id: 'org-personal', isVisible: null });
  const orgA = makeOrg({ id: 'org-a', isVisible: true });
  const orgB = makeOrg({ id: 'org-b', isVisible: true });

  it('returns source=url when paramsId is a member org', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-a',
      lastActiveOrgId: null,
      myOrganizations: [personal, orgA, orgB],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.activeOrg).toBe(orgA);
    expect(r.personalOrgId).toBe('org-personal');
    expect(r.source).toBe('url');
  });

  it('returns source=lastActive when paramsId is undefined and lastActiveOrgId is a member', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: 'org-b',
      myOrganizations: [personal, orgA, orgB],
    });
    expect(r.activeOrgId).toBe('org-b');
    expect(r.activeOrg).toBe(orgB);
    expect(r.source).toBe('lastActive');
  });

  it('returns source=personal when both URL and lastActiveOrgId are absent', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: [personal, orgA],
    });
    expect(r.activeOrgId).toBe('org-personal');
    expect(r.activeOrg).toBe(personal);
    expect(r.source).toBe('personal');
  });

  it('falls through URL → lastActive → personal when paramsId is not a member org (R-9)', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-unknown',
      lastActiveOrgId: 'org-a',
      myOrganizations: [personal, orgA],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.source).toBe('lastActive');
  });

  it('falls through to personal when both paramsId AND lastActiveOrgId are non-member', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-unknown',
      lastActiveOrgId: 'org-gone',
      myOrganizations: [personal, orgA],
    });
    expect(r.activeOrgId).toBe('org-personal');
    expect(r.source).toBe('personal');
  });

  it('falls through to personal when lastActiveOrgId points to a stale (non-member) org (FR-009)', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: 'org-deleted',
      myOrganizations: [personal, orgA],
    });
    expect(r.activeOrgId).toBe('org-personal');
    expect(r.source).toBe('personal');
  });

  it('returns source=none when no personal org exists (defensive, R-2)', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: [orgA, orgB], // no isVisible === null
    });
    expect(r.activeOrgId).toBeNull();
    expect(r.activeOrg).toBeNull();
    expect(r.personalOrgId).toBeNull();
    expect(r.source).toBe('none');
  });

  it('returns source=none when membership list is empty (unreachable platform state)', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-anything',
      lastActiveOrgId: 'org-anything',
      myOrganizations: [],
    });
    expect(r.source).toBe('none');
  });

  it('always exposes personalOrgId regardless of which step picked the active org', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-a',
      lastActiveOrgId: null,
      myOrganizations: [personal, orgA],
    });
    expect(r.source).toBe('url');
    expect(r.personalOrgId).toBe('org-personal');
  });

  // hadron-server's `personal-workspace.ts` writes `isVisible: false` on
  // provisioning; the read filter is `{ not: true }`. Lock in that both
  // null AND false count as "personal" so the portal stays aligned with
  // the server contract.
  it('treats isVisible=false as personal (hadron-server provisioning shape)', () => {
    const personalFalse = makeOrg({ id: 'org-personal-false', isVisible: false });
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: [personalFalse, orgA],
    });
    expect(r.activeOrgId).toBe('org-personal-false');
    expect(r.personalOrgId).toBe('org-personal-false');
    expect(r.source).toBe('personal');
  });

  it('prefers isVisible=true orgs over isVisible=false when the URL points at a visible one', () => {
    const personalFalse = makeOrg({ id: 'org-personal-false', isVisible: false });
    const r = resolveActiveOrg({
      paramsId: 'org-a',
      lastActiveOrgId: null,
      myOrganizations: [personalFalse, orgA],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.personalOrgId).toBe('org-personal-false');
    expect(r.source).toBe('url');
  });
});

describe('filterToMemberOrgs — hadron-server#473 admin unscoped reach', () => {
  const member = (userId: string, orgId: string) => ({
    id: `member-${orgId}-${userId}`,
    role: 'MEMBER',
    canInvite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    user: { id: userId, handle: null, githubUsername: null, name: null, avatarUrl: null, email: null },
  });

  it('keeps only orgs carrying a membership row for the user', () => {
    const mine = makeOrg({ id: 'org-mine', members: [member('u1', 'org-mine')] });
    const foreign = makeOrg({ id: 'org-foreign', members: [member('u2', 'org-foreign')] });
    const shared = makeOrg({ id: 'org-shared', members: [member('u2', 'org-shared'), member('u1', 'org-shared')] });
    expect(filterToMemberOrgs([foreign, mine, shared], 'u1').map((o) => o.id))
      .toEqual(['org-mine', 'org-shared']);
  });

  it('drops orgs with no members selection (defensive) and returns [] without a user id', () => {
    const noMembers = makeOrg({ id: 'org-no-members', members: undefined });
    expect(filterToMemberOrgs([noMembers], 'u1')).toEqual([]);
    expect(filterToMemberOrgs([noMembers], null)).toEqual([]);
    expect(filterToMemberOrgs([noMembers], undefined)).toEqual([]);
  });

  it("admin regression (PR #451 P2): another user's personal org sorting first no longer wins the personal fallback", () => {
    // organizations() gives an admin EVERY org — including other users'
    // personal orgs (isVisible !== true). Unfiltered, the first of those
    // would win resolveActiveOrg's personal-org step.
    const foreignPersonal = makeOrg({ id: 'org-aaa-foreign', isVisible: null, members: [member('u2', 'org-aaa-foreign')] });
    const ownPersonal = makeOrg({ id: 'org-zzz-own', isVisible: null, members: [member('u1', 'org-zzz-own')] });
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: filterToMemberOrgs([foreignPersonal, ownPersonal], 'u1'),
    });
    expect(r.source).toBe('personal');
    expect(r.activeOrgId).toBe('org-zzz-own');
    expect(r.personalOrgId).toBe('org-zzz-own');
  });
});
