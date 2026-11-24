/**
 * portal#2567: who is SHOWN the AI-config controls. The server stays the authority
 * (`requireAiConfigOwnerAdmin`): this only stops the portal hiding what it permits, and
 * showing what it refuses.
 *
 * Org-owned: the viewer's org role, as it always was. Person-owned: only the owner
 * (hrn:node:hadronmemory.com:specs:cor:dmo:050:10, and :12, :13 beside it: not an owner-role member, and a platform admin may only clear).
 */
import type { OrgMember } from '$lib/types';

/** An OWNER or ADMIN row of the viewer in the owning organization's member list. */
export function orgRoleCanManage(members: readonly OrgMember[] | null | undefined, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return !!members?.some((m) => m.user.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN'));
}

export function aiConfigCanManage(input: {
  /** True when no organization owns the App or Agent. */
  ownerIsPerson: boolean;
  orgMembers?: readonly OrgMember[] | null;
  userId: string | null | undefined;
  /** The server's `effectiveAccess.canManage` for the viewer; null is UNKNOWN, never no. */
  canManageFlag?: boolean | null;
  impersonating?: boolean;
  /**
   * Agent only. `effectiveAccess` reports manage to a platform admin on someone's personal Agent,
   * and the AI-config gate refuses them; the Agent has no owner field here to tell an admin who is
   * also the owner apart, so an admin is read-only (the CLI still works for them).
   */
  platformAdmin?: boolean;
}): boolean {
  if (!input.userId) return false;
  if (!input.ownerIsPerson) return orgRoleCanManage(input.orgMembers, input.userId);
  return input.canManageFlag === true && !input.impersonating && !input.platformAdmin;
}
