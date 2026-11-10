import { isSharePrincipal, type ShareGateMemory, type ShareGateUser } from './can-manage-shares';

export interface SettingsGateMemory extends ShareGateMemory {
  class?: string | null;
  organizationId?: string | null;
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
