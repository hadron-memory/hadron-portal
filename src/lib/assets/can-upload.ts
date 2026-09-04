/**
 * Can this memory accept a NEW upload?
 *
 * Extracted from the components so the Files tab and the attach dialog can't
 * drift, and so it is testable (hrn:node:hadronmemory.com:hadron-portal:conventions:svelte-component-test-gap).
 *
 * **History — why this is one gate now, not two.** It also used to block
 * USER-OWNED memories (spec 047 personal/private, `organizationId: null`),
 * because hadron-server derived the object-storage key from the memory's
 * ORG urn and rejected an org-less memory outright. That made every memory
 * under "My memories" — the whole surface an individual user lives in —
 * offer an Upload control that could only ever fail, and fail opaquely,
 * since the server's `AssetUploadError` code never reaches
 * `extensions.code`.
 *
 * hadron-server#891 removed the limitation rather than the symptom: the
 * storage key is derived from the memory URN alone, which is byte-identical
 * for org-owned memories and works for user-owned ones with no migration.
 * A personal memory now uploads like any other, so the `user-owned` branch
 * is deleted rather than reworded — keeping it would hide a control that
 * works.
 */

export interface UploadTarget {
  /** Per-memory gate; default true, false for system-class. */
  acceptsUploads?: boolean;
}

/**
 * `false` only when the memory explicitly refuses uploads.
 *
 * When this is false, NOTHING can add a file — not the user and not an
 * agent run either, since `hadron_store_file` runs the same
 * `assertMemoryAcceptsUploads` gate server-side. UI copy must not promise
 * an agent-run path around it.
 *
 * `acceptsUploads` is optional because not every projection selects it —
 * only an explicit `false` blocks, so a slim projection never silently
 * hides the control.
 *
 * Deliberately does NOT gate listing, download, or attaching an EXISTING
 * asset: `createAssetReferenceNode` needs read on the asset's memory and
 * write on the target's, and neither consults this flag.
 */
export function canUploadToMemory(memory: UploadTarget | null | undefined): boolean {
  if (!memory) return false;
  return memory.acceptsUploads !== false;
}
