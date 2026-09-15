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
 * ## What it mirrors
 *
 * The server's own rule, for the only class where shares can exist. Shares are
 * `personal`-class only (spec 023 FR-018), personal memories are user-owned,
 * and the resolver short-circuits `if (!orgId) return []` — so the org-admin
 * fallback cannot apply to them. That leaves the principal and a platform
 * admin, which is what this returns.
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

export function canManageShares(
  memory: ShareGateMemory | null | undefined,
  user: ShareGateUser | null | undefined,
): boolean {
  if (!memory || !user?.id) return false;

  // The principal. The `!= null` is defence in depth, NOT the thing that stops
  // a null-matches-null grant — the `!user?.id` guard above already does that,
  // proven by mutating this line away and watching every test stay green. It
  // stays so the comparison remains correct if that guard is ever loosened, and
  // is described as belt-and-braces rather than as load-bearing.
  if (memory.userId != null && memory.userId === user.id) return true;

  const roles = user.roles ?? [];
  return roles.includes('ADMIN') || roles.includes('OWNER');
}
