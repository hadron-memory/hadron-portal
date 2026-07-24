import { describe, expect, it } from 'vitest';
import { filterToMemberOrgs, resolveActiveOrg } from './active-org';
import type { Organization } from '$lib/types';

function makeOrg(overrides: Partial<Organization>): Organization {
  return {
    id: 'org-id',
    name: 'Org',
    urn: 'org:example',
    githubInstallationId: null,
    githubAppId: null,
    hasGithubAppPrivateKey: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveActiveOrg — spec 014 R-1/R-9 (post-#627, no personal org)', () => {
  const orgA = makeOrg({ id: 'org-a' });
  const orgB = makeOrg({ id: 'org-b' });
  const orgC = makeOrg({ id: 'org-c' });

  it('returns source=url when paramsId is a member org', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-b',
      lastActiveOrgId: null,
      myOrganizations: [orgA, orgB, orgC],
    });
    expect(r.activeOrgId).toBe('org-b');
    expect(r.activeOrg).toBe(orgB);
    expect(r.source).toBe('url');
  });

  it('returns source=lastActive when paramsId is undefined and lastActiveOrgId is a member', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: 'org-b',
      myOrganizations: [orgA, orgB, orgC],
    });
    expect(r.activeOrgId).toBe('org-b');
    expect(r.activeOrg).toBe(orgB);
    expect(r.source).toBe('lastActive');
  });

  it('falls back to the FIRST membership when both URL and lastActiveOrgId are absent', () => {
    // Regression for the "member of several orgs sees none" bug: with no URL
    // hint (e.g. on /app/dashboard) and no cookie, a member must still land on
    // an org so the org surface + switcher render.
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: [orgA, orgB, orgC],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.activeOrg).toBe(orgA);
    expect(r.source).toBe('first');
  });

  it('falls through URL → lastActive → first when paramsId is not a member org (R-9)', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-unknown',
      lastActiveOrgId: 'org-b',
      myOrganizations: [orgA, orgB],
    });
    expect(r.activeOrgId).toBe('org-b');
    expect(r.source).toBe('lastActive');
  });

  it('falls through to the first membership when both paramsId AND lastActiveOrgId are non-member', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-unknown',
      lastActiveOrgId: 'org-gone',
      myOrganizations: [orgA, orgB],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.source).toBe('first');
  });

  it('ignores a stale (non-member) lastActiveOrgId and falls back to first (FR-009)', () => {
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: 'org-deleted',
      myOrganizations: [orgA, orgB],
    });
    expect(r.activeOrgId).toBe('org-a');
    expect(r.source).toBe('first');
  });

  it('returns source=none when the user has NO memberships (org-less individual, #627)', () => {
    const r = resolveActiveOrg({
      paramsId: 'org-anything',
      lastActiveOrgId: 'org-anything',
      myOrganizations: [],
    });
    expect(r.activeOrgId).toBeNull();
    expect(r.activeOrg).toBeNull();
    expect(r.source).toBe('none');
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

  it("admin regression (PR #451 P2): the first-membership fallback only ever considers the user's OWN orgs", () => {
    // organizations() gives an admin EVERY org — including other users' orgs.
    // Unfiltered, a foreign org sorting first would win the first-membership
    // step. filterToMemberOrgs must strip it before resolution.
    const foreign = makeOrg({ id: 'org-aaa-foreign', members: [member('u2', 'org-aaa-foreign')] });
    const own = makeOrg({ id: 'org-zzz-own', members: [member('u1', 'org-zzz-own')] });
    const r = resolveActiveOrg({
      paramsId: undefined,
      lastActiveOrgId: null,
      myOrganizations: filterToMemberOrgs([foreign, own], 'u1'),
    });
    expect(r.source).toBe('first');
    expect(r.activeOrgId).toBe('org-zzz-own');
  });
});
