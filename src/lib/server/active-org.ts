// Active-organization resolution helper for the portal.
//
// Spec: 014-single-active-org. See research.md R-1 (resolution location),
// R-9 (inaccessible-org fall-through with path preservation). The chain is:
//   1. URL hint  — params.id when under /app/orgs/[id]/...
//   2. lastActiveOrgId — User field, set by the portal on every org-scoped load
//   3. first membership — the caller's org with the lexicographically-first id
//      (a STABLE default; the query doesn't guarantee order), so a member
//      always lands on an org.
// Each step is filtered through the user's membership list; non-member ids
// are treated as absent so the chain continues. A user with NO memberships
// (an org-less individual — #627) resolves to `none` / null, and the layout
// renders the consumer surface.
//
// History: the fallback used to pick a "personal org" (an invisible per-user
// org identified by `isVisible !== true`). The personal-org concept — and the
// `Organization.isVisible` field — were removed as #627 moved individuals to
// org-less, user-owned memories. Individuals now simply have zero orgs; a
// member falls back to their first org.
//
// Pure helper: no I/O, no redirects. Callers compose with
// `redirect(302, ...)` themselves (SvelteKit's redirect helper throws
// internally; the codebase calls it directly without an outer `throw`).

import type { Organization } from '$lib/types';

export type ActiveOrgSource = 'url' | 'lastActive' | 'first' | 'none';

export interface ActiveOrgResolution {
  activeOrgId: string | null;
  activeOrg: Organization | null;
  source: ActiveOrgSource;
}

/**
 * hadron-server#473: the uniform organizations() list returns EVERY live org
 * for a platform ADMIN/OWNER, not just the caller's memberships. Active-org
 * resolution must only ever consider orgs the user is actually a member of —
 * otherwise an admin's first-membership fallback can resolve to ANOTHER user's
 * org.
 *
 * The server now filters too: resolution callers fetch via
 * ORGANIZATIONS_NAV_QUERY, which passes filter.memberOnly so even a platform
 * admin only receives their memberships (hrn:node:hadronmemory.com:specs:cor:api:120:03). This client-side
 * pass over members[].user.id stays as cheap defense-in-depth — it also
 * covers any caller still feeding the unfiltered browse query through
 * resolveActiveOrg.
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

  // Step 1: URL hint, filtered through membership.
  if (paramsId) {
    const urlOrg = myOrganizations.find((o) => o.id === paramsId);
    if (urlOrg) {
      return { activeOrgId: urlOrg.id, activeOrg: urlOrg, source: 'url' };
    }
  }

  // Step 2: lastActiveOrgId, filtered through membership.
  if (lastActiveOrgId) {
    const lastOrg = myOrganizations.find((o) => o.id === lastActiveOrgId);
    if (lastOrg) {
      return { activeOrgId: lastOrg.id, activeOrg: lastOrg, source: 'lastActive' };
    }
  }

  // Step 3: first membership. A member always lands on an org; the OrgSwitcher
  // lets them change it. Only a user with zero memberships falls through. The
  // nav query doesn't guarantee an order, so pick the lexicographically-first
  // id — a STABLE default, so the same user doesn't get a different active org
  // across loads (Copilot review on #639). Once they navigate to an org, the
  // cookie takes over.
  const firstOrg =
    myOrganizations.length > 0
      ? [...myOrganizations].sort((a, b) => a.id.localeCompare(b.id))[0]
      : null;
  if (firstOrg) {
    return { activeOrgId: firstOrg.id, activeOrg: firstOrg, source: 'first' };
  }

  // No memberships — an org-less individual (#627). The layout renders the
  // consumer surface (isConsumerMode).
  return { activeOrgId: null, activeOrg: null, source: 'none' };
}
