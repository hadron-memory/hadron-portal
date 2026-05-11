import { describe, expect, it } from 'vitest';
import { resolveActiveOrg } from './active-org';
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
});
