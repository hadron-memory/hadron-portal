// Active-organization resolution helper for the portal.
//
// Spec: 014-single-active-org. See research.md R-1 (resolution location),
// R-2 (personal org identification), R-9 (inaccessible-org fall-through
// with path preservation). The chain is:
//   1. URL hint  — params.id when under /app/orgs/[id]/...
//   2. lastActiveOrgId — User field, set by the portal on every org-scoped load
//   3. personal org — orgs.find(o => o.isVisible !== true)
// Each step is filtered through the user's membership list; non-member ids
// are treated as absent so the chain continues.
//
// Personal-org contract: hadron-server's `personal-workspace.ts` writes
// `isVisible: false`, and every server-side read uses `isVisible: { not: true }`
// (e.g. `server.ts:290`, `resolvers.ts:3315`). The migration column is
// nullable, so the platform answer is "not visible" = null OR false. Match
// the server filter exactly, not just one of the two states.
//
// Pure helper: no I/O, no redirects. Callers compose with
// `redirect(302, ...)` themselves (SvelteKit's redirect helper throws
// internally; the codebase calls it directly without an outer `throw`).

import type { Organization } from '$lib/types';

export type ActiveOrgSource = 'url' | 'lastActive' | 'personal' | 'none';

export interface ActiveOrgResolution {
  activeOrgId: string | null;
  activeOrg: Organization | null;
  personalOrgId: string | null;
  source: ActiveOrgSource;
}

/**
 * hadron-server#473: the uniform organizations() list returns EVERY live org
 * for a platform ADMIN/OWNER, not just the caller's memberships. Active-org /
 * personal-org resolution must only ever consider orgs the user is actually a
 * member of — otherwise an admin's 'personal' fallback (isVisible !== true)
 * can resolve to ANOTHER user's personal org. Filter client-side on the
 * nested members selection (ORGANIZATIONS_QUERY selects members[].user.id)
 * until the server grows a memberships-only filter (planned follow-up).
 *
 * Every resolveActiveOrg caller MUST pass its organizations() result through
 * this first.
 */
export function filterToMemberOrgs(
  orgs: Organization[],
  userId: string | null | undefined,
): Organization[] {
  if (!userId) return [];
  return orgs.filter((o) => (o.members ?? []).some((m) => m.user?.id === userId));
}

export interface ResolveActiveOrgInput {
  paramsId: string | undefined;
  lastActiveOrgId: string | null;
  myOrganizations: Organization[];
}

export function resolveActiveOrg(input: ResolveActiveOrgInput): ActiveOrgResolution {
  const { paramsId, lastActiveOrgId, myOrganizations } = input;

  const personalOrg = myOrganizations.find((o) => o.isVisible !== true) ?? null;
  const personalOrgId = personalOrg?.id ?? null;

  // Step 1: URL hint, filtered through membership.
  if (paramsId) {
    const urlOrg = myOrganizations.find((o) => o.id === paramsId);
    if (urlOrg) {
      return {
        activeOrgId: urlOrg.id,
        activeOrg: urlOrg,
        personalOrgId,
        source: 'url',
      };
    }
  }

  // Step 2: lastActiveOrgId, filtered through membership.
  if (lastActiveOrgId) {
    const lastOrg = myOrganizations.find((o) => o.id === lastActiveOrgId);
    if (lastOrg) {
      return {
        activeOrgId: lastOrg.id,
        activeOrg: lastOrg,
        personalOrgId,
        source: 'lastActive',
      };
    }
  }

  // Step 3: personal org.
  if (personalOrg) {
    return {
      activeOrgId: personalOrg.id,
      activeOrg: personalOrg,
      personalOrgId,
      source: 'personal',
    };
  }

  // Defensive: platform invariant says every user has a personal org;
  // if not, surface as 'none' so the caller can route to a recovery surface.
  return {
    activeOrgId: null,
    activeOrg: null,
    personalOrgId: null,
    source: 'none',
  };
}
