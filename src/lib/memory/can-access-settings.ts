import { isSharePrincipal, type ShareGateMemory, type ShareGateUser } from './can-manage-shares';

export interface SettingsGateMemory extends ShareGateMemory {
  class?: string | null;
  organizationId?: string | null;
}

export interface MemorySettingsManageInput {
  memory: SettingsGateMemory | null | undefined;
  user: ShareGateUser | null | undefined;
  orgAvailable: boolean;
  orgReadFailed: boolean;
  canManageMemory: boolean;
  canWriteMemory: boolean;
  impersonating: boolean;
  myMember?: { role?: string | null } | null;
}

/**
 * The layout chrome and direct Settings route share one display gate. The
 * server's effectiveAccess.canManage remains the mutation-authority input;
 * this predicate only keeps a known non-member out of an owner/member surface.
 */
export function canAccessMemorySettings(
  memory: SettingsGateMemory | null | undefined,
  user: ShareGateUser | null | undefined,
  orgAvailable: boolean,
  orgReadFailed: boolean,
): boolean {
  if (!memory) return false;
  if (memory.class === 'personal' || memory.class === 'private') {
    return isSharePrincipal(memory, user);
  }
  const platformAdmin = user?.roles?.includes('ADMIN') || user?.roles?.includes('OWNER');
  return platformAdmin === true || !memory.organizationId || orgAvailable || orgReadFailed;
}

/**
 * Display gate for controls backed by memory-manage authority. Group org
 * ADMIN/OWNER membership remains an explicit fallback because the server's
 * effectiveAccess.canManage projection can under-report that path.
 */
export function canEditMemorySettings({
  memory,
  user,
  orgAvailable,
  orgReadFailed,
  canManageMemory,
  canWriteMemory,
  impersonating,
  myMember,
}: MemorySettingsManageInput): boolean {
  if (!memory || impersonating || !canAccessMemorySettings(memory, user, orgAvailable, orgReadFailed)) return false;
  if (memory.class === 'personal' || memory.class === 'private') {
    return isSharePrincipal(memory, user) && canManageMemory;
  }
  if (!memory.organizationId) {
    // Memory.userId is not exposed for a user-owned non-personal memory. Keep
    // the prior combined guard rather than treating a clone-only manage grant
    // as updateMemory authority.
    return canManageMemory && canWriteMemory;
  }
  // effectiveAccess.canManage also includes memory.clone grants. Only the
  // facts that requireMemoryManageAccess accepts may enable org Settings.
  const platformAdmin = user?.roles?.includes('ADMIN') || user?.roles?.includes('OWNER');
  return platformAdmin === true || myMember?.role === 'ADMIN' || myMember?.role === 'OWNER';
}
