/**
 * Can this memory accept a NEW upload?
 *
 * Two independent gates, and both have to hold. Extracted from the components so
 * the Files tab and the attach dialog can't drift, and so it is testable
 * (conventions:svelte-component-test-gap).
 */

export interface UploadTarget {
  /** Null for a user-owned memory (spec 047 personal / private). */
  organizationId?: string | null;
  /** Per-memory gate; default true, false for system-class. */
  acceptsUploads?: boolean;
}

/**
 * `false` when the memory refuses uploads, or when it is USER-OWNED.
 *
 * The user-owned half is the non-obvious one and it is not covered by
 * `acceptsUploads`, which defaults **true** for personal-class memories.
 * hadron-server's `beginAssetUpload` rejects any memory with no organization
 * outright — the storage key is org-scoped, so upload "isn't yet modeled for a
 * user-owned memory" — and it throws that as an `AssetUploadError` whose code
 * does NOT reach `extensions.code`, so the portal receives a bare
 * INTERNAL_SERVER_ERROR and can only report "the server had a problem".
 *
 * Result, before this gate existed: every memory under "My memories" — the whole
 * surface an individual user lives in — showed an Upload control and an
 * "Attach file" action that could only ever fail, opaquely. Hiding the affordance
 * is the honest fix until the server models user-owned storage keys.
 *
 * Deliberately does NOT gate listing, download, or attaching an EXISTING asset:
 * those work fine on a user-owned memory (`createAssetReferenceNode` needs read on
 * the asset's memory and write on the target's, with no org requirement).
 *
 * `acceptsUploads` is optional because not every projection selects it — only an
 * explicit `false` blocks, so a slim projection never silently hides the control.
 * `organizationId` is treated the other way round: it is non-optional in the
 * schema and every memory projection selects it, and a MISSING org is exactly the
 * blocking condition, so `undefined` blocks too.
 */
export function canUploadToMemory(memory: UploadTarget | null | undefined): boolean {
  if (!memory) return false;
  if (memory.acceptsUploads === false) return false;
  return !!memory.organizationId;
}

/** Why upload is unavailable — drives which explanation the UI shows. */
export type UploadBlockedReason = 'user-owned' | 'refuses-uploads' | null;

export function uploadBlockedReason(
  memory: UploadTarget | null | undefined,
): UploadBlockedReason {
  if (!memory) return 'refuses-uploads';
  // Check the explicit refusal first: when both hold, "this memory doesn't accept
  // uploads" is the more fundamental statement.
  if (memory.acceptsUploads === false) return 'refuses-uploads';
  if (!memory.organizationId) return 'user-owned';
  return null;
}
