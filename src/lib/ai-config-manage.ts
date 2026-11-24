/**
 * portal#2567: who is SHOWN the AI-config controls. The server stays the authority
 * (`requireAiConfigOwnerAdmin`): this only stops the portal hiding what it permits, and
 * showing what it refuses.
 *
 * Org-owned: the viewer's org role, exactly as before this change.
 * Person-owned: only the owner. The spec (hrn:node:hadronmemory.com:specs:cor:dmo:050:10, with :12 for an
 * App and :13 for an Agent) says the same three things: an owner-role member of a person's App may not set
 * the key, a platform admin may only clear it, and an impersonated session never sets it.
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
  /**
   * Read for a person's App or Agent only. An organization's keeps the rule it had before this change: the
   * org role decides, and the server refuses every write from an impersonated session anyway (cor:acl:100:02),
   * so for an organization the worst case is a control the server already refused before.
   */
  impersonating?: boolean;
  /**
   * Agent only. `effectiveAccess` reports manage to a platform admin on someone's personal Agent, and the
   * AI-config gate refuses them; the Agent has no owner field here to tell an admin who is also the owner
   * apart, so an admin is read-only (the CLI still works for them). An App needs no such term: for a
   * person's App `effectiveAccess` gives manage to the owner and to nobody else, and the drift there runs
   * the safe way (an owner-role member reads false), see `selfCanManage` in `boot-prompt-pointer.ts`.
   */
  platformAdmin?: boolean;
}): boolean {
  if (!input.userId) return false;
  if (!input.ownerIsPerson) return orgRoleCanManage(input.orgMembers, input.userId);
  return input.canManageFlag === true && !input.impersonating && !input.platformAdmin;
}
