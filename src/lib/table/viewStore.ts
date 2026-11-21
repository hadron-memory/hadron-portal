// Saved-view persistence seam (spec 020). The UI depends only on this interface,
// so the localStorage implementation can be replaced by a server-backed one
// without touching any list or the picker (spec SC-007). Operations are async to
// allow a future networked implementation.
import type { SavedView } from './savedView';

/** Max length of a view name (spec FR-015). */
export const MAX_VIEW_NAME_LENGTH = 100;

/** A named, persisted view scoped to a list. Shaped to be server-ready (FR-012). */
export interface SavedViewRecord {
  id: string;
  listKey: string;
  name: string;
  view: SavedView;
  isDefault: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Thrown by writes that cannot complete (e.g. storage disabled/full, bad name). */
export class ViewStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewStorageError';
  }
}

/**
 * The user-visible messages the storage seam can throw, as ONE family. The
 * ViewTabs strip renders `e.message` verbatim for these, and the client-lane
 * "no storage error rendered" pins key on exactly this family (plus
 * ViewTabs.run's generic catch-all) through the shared `viewStorageErrorText`
 * in $lib/test — which is BUILT from these constants, so a reword here rides
 * along instead of silently emptying the match. Throw sites must use these
 * constants, never a fresh literal, or that guarantee breaks.
 */
export const viewStorageErrorMessages = {
  unavailable: 'Storage is unavailable.',
  saveFailed: 'Could not save views (storage full or disabled).',
  viewNotFound: 'View not found.',
  saveActiveFailed: 'Could not save the active view.',
  emptyName: 'View name cannot be empty.',
} as const;

export interface ViewStore {
  list(listKey: string): Promise<SavedViewRecord[]>;
  get(listKey: string, id: string): Promise<SavedViewRecord | null>;
  create(listKey: string, name: string, view: SavedView): Promise<SavedViewRecord>;
  /** Patch name/view only — `isDefault` is owned by setDefault (one-default invariant). */
  update(
    listKey: string,
    id: string,
    patch: Partial<Pick<SavedViewRecord, 'name' | 'view'>>,
  ): Promise<SavedViewRecord>;
  remove(listKey: string, id: string): Promise<void>;

  getDefault(listKey: string): Promise<SavedViewRecord | null>;
  setDefault(listKey: string, id: string | null): Promise<void>;

  getActiveId(listKey: string): Promise<string | null>;
  setActiveId(listKey: string, id: string | null): Promise<void>;
}

/**
 * Validate + normalize a view name. Trims, rejects empty, caps length.
 * Duplicates ARE allowed (records are keyed by id, not name).
 */
export function normalizeViewName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new ViewStorageError(viewStorageErrorMessages.emptyName);
  return trimmed.slice(0, MAX_VIEW_NAME_LENGTH);
}

/**
 * Pure resolution of which view to apply on open: remembered active → default →
 * none (built-in). Pure (no runes) so it is unit-testable directly.
 */
export function resolveInitialView(
  views: SavedViewRecord[],
  storedActiveId: string | null,
): SavedViewRecord | null {
  return (
    (storedActiveId ? views.find((v) => v.id === storedActiveId) : undefined) ??
    views.find((v) => v.isDefault) ??
    null
  );
}

// ── List key helpers ───────────────────────────────────────────────────────
// Opaque, stable per-list keys (spec FR-001). Callers build them; the picker
// only passes the key through. Helpers keep the scheme consistent.
export const listKeys = {
  memoryNodes: (memoryId: string) => `memory:${memoryId}:nodes`,
  agents: (orgId?: string) => (orgId ? `org:${orgId}:agents` : 'agents'),
  usageSessions: () => 'usage:sessions',
  usageMemory: () => 'usage:memory',
} as const;
