/**
 * May this caller see and manage a memory's shares? (#668, @codex P1 on #839)
 *
 * ## Why the portal derives this at all
 *
 * Normally it should not — the server owns authorization and the portal renders
 * its answer. But `Memory.shares` gives no answer to render:
 *
 *     shares: [MemoryShare!]!
 *
 * It is **non-null**, and hadron-server's resolver
 * (`resolvers.types.ts`, `Memory.shares`) returns **`[]`** on every
 * unauthorized path — not null, not an error. So "you may not see this" and
 * "nobody has access" arrive as the identical value, and a page that renders
 * the empty list tells a non-owner the memory is shared with nobody and offers
 * them a grant form. That is a false statement about someone else's memory, not
 * a missing feature.
 *
 * Nothing on the wire distinguishes the two, so the gate has to be computed
 * from facts that ARE on the entity.
 *
 * ## READ and EDIT are different gates, and the server does not treat them alike
 *
 * @copilot on #839 caught this and it is verified in the resolvers:
 *
 * - **read** (`Memory.shares`, `resolvers.types.ts`) allows the principal, a
 *   platform ADMIN/OWNER, or an org ADMIN/OWNER of the owning org.
 * - **write** (`createMemoryShare` / `updateMemoryShareRole` /
 *   `deleteMemoryShare` with a grantee) goes through
 *   `requireMemorySharePrincipal` → `isMemorySharePrincipal`, which is exactly
 *   `memory.userId === ctx.userId`. **No platform-admin bypass.**
 *
 * So a platform admin may LIST a memory's shares and may not change them. One
 * predicate for both would either hide the list from them or offer them three
 * controls whose every submission is FORBIDDEN. Hence two functions.
 *
 * The org-admin read branch is deliberately not modelled here: shares exist
 * only on personal-class memories, which are user-owned, and the read resolver
 * short-circuits `if (!orgId) return []` before reaching it.
 *
 * ## It is a DISPLAY gate, never the boundary
 *
 * The server refuses regardless. This exists so the portal does not make a
 * claim it cannot support — and it is deliberately the ONE place the predicate
 * lives, because the tab and the page body both need it and two copies drifting
 * is how one of them starts lying again.
 *
 * The real fix is server-side: a derived `Memory.canManageShares`, exactly as
 * `Memory.shareable` (#766) was added so clients could "surface or gate the
 * share action before a createMemoryShare attempt rather than discovering
 * InvalidMemoryClassForShareError at execution time". Reported; until it
 * exists, this is the honest approximation and says so.
 */

export interface ShareGateMemory {
  /** The memory's principal — `Memory.userId`. Null for an org-owned memory. */
  userId?: string | null;
}

export interface ShareGateUser {
  id?: string | null;
  /** Platform roles. ADMIN/OWNER read any memory's shares, per the resolver. */
  roles?: string[] | null;
}

/**
 * Is this caller the memory's PRINCIPAL — the only identity the server lets
 * create, re-role or revoke a share?
 */
export function isSharePrincipal(
  memory: ShareGateMemory | null | undefined,
  user: ShareGateUser | null | undefined,
): boolean {
  if (!memory || !user?.id) return false;
  // The `!= null` is defence in depth, NOT the thing that stops a
  // null-matches-null grant — the `!user?.id` guard above already does that,
  // proven by mutating this line away and watching every test stay green.
  return memory.userId != null && memory.userId === user.id;
}

/** May this caller SEE the share list? Principal, or a platform admin. */
export function canSeeShares(
  memory: ShareGateMemory | null | undefined,
  user: ShareGateUser | null | undefined,
): boolean {
  if (!memory || !user?.id) return false;
  if (isSharePrincipal(memory, user)) return true;
  const roles = user.roles ?? [];
  return roles.includes('ADMIN') || roles.includes('OWNER');
}

/**
 * May this caller CHANGE the shares? Principal only — a platform admin reading
 * the list is not entitled to edit it (`isMemorySharePrincipal`).
 */
export const canEditShares = isSharePrincipal;
