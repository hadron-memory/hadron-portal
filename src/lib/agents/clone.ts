/**
 * #1262 — client side of the S1 `cloneAgent` contract.
 *
 * Everything here is a presentation hint over a server that is authoritative:
 * the target-org list only narrows the picker (the server requires ADMIN in the
 * target and refuses otherwise), and every refusal is mapped to a fixed,
 * localized message (see $lib/server/clone-refusal). Nothing from `extensions` is passed through except the
 * sanitized blocker fields, so an unknown error can never dump a payload.
 */

type OrgWithMembers = {
  id: string;
  urn: string;
  name: string;
  members?: Array<{ role: string; user: { id: string } }> | null;
};

/** Orgs where the caller is OWNER or ADMIN — a UI hint only. */
export function eligibleCloneTargets<T extends OrgWithMembers>(orgs: T[], userId: string | null | undefined): T[] {
  if (!userId) return [];
  return orgs.filter((o) =>
    (o.members ?? []).some((m) => m.user.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN')),
  );
}

/** The entry shows for a PUBLIC source or one the caller manages, and only with somewhere to clone to. */
export function showCloneEntry(o: { visibility: string | null | undefined; canManage: boolean; eligibleCount: number }): boolean {
  return o.eligibleCount > 0 && (o.visibility === 'PUBLIC' || o.canManage);
}

export type CloneBlocker = {
  code: string;
  count: number;
  subjects: Array<{ position: number; name?: string }>;
};
