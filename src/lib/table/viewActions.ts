// Pure (runes-free) orchestration for saved-view actions. The runes controller
// delegates to these so the meaningful behavior is unit-testable in node with a
// fake ViewStore + a minimal table stub (the project's vitest runs without the
// Svelte plugin, so `*.svelte.ts` runes modules can't be instantiated in tests).
import type { PortalTable } from '$lib/table/features';
import type { RowData } from '@tanstack/table-core';
import { extractTableView, applyView, normalizeView, mergeMissingColumns, type SavedView } from './savedView';
import { type ViewStore, type SavedViewRecord, ViewStorageError } from './viewStore';

/** The list's current default column order — the definition order of its
 * leaf columns (no list ships a non-empty initial columnOrder). */
function defaultColumnOrder<T extends RowData>(table: PortalTable<T>): string[] {
  return table.getAllLeafColumns().map((c) => c.id);
}

/**
 * Persist a precomputed merge BEST-EFFORT — the one quota-path implementation
 * shared by every read path (portal#2274 P2): the store's contract is that
 * reads degrade while writes throw (quota exceeded, storage disabled), and a
 * failing write must not stop the saved arrangement from applying — the merged
 * record is returned in memory and the next mount re-attempts the merge.
 * Anything that is not a ViewStorageError is a real bug and still throws.
 * init() and migrateStoredView both go through here so their behavior cannot
 * drift apart again (it did: init's inline persist lacked this fallback and a
 * quota-full store stopped the mount from applying the arrangement at all).
 */
export async function persistMergeBestEffort(
  store: ViewStore,
  listKey: string,
  record: SavedViewRecord,
  merged: SavedView,
): Promise<SavedViewRecord> {
  try {
    return await store.update(listKey, record.id, { view: merged });
  } catch (e) {
    if (e instanceof ViewStorageError) return { ...record, view: merged };
    throw e;
  }
}

/**
 * Migrate a stored record for application (portal#2253 item 4): merge columns
 * the saved order predates in at their default position, and PERSIST the merge
 * — applying a merged order while the stored record keeps its pre-merge one
 * would leave the view permanently "modified" (Save/Reset popping on every
 * load) for a change the user never made. Returns the record unchanged when
 * the merge is a no-op, so callers can skip both the write and the state swap.
 * The persist itself is best-effort — see persistMergeBestEffort.
 */
export async function migrateStoredView<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  record: SavedViewRecord,
): Promise<SavedViewRecord> {
  const columnOrder = mergeMissingColumns(defaultColumnOrder(table), record.view.columnOrder);
  if (columnOrder === record.view.columnOrder) return record;
  return persistMergeBestEffort(store, listKey, record, { ...record.view, columnOrder });
}

/** Compute a record's migration IN MEMORY — the same merge migrateStoredView
 * applies, but never persisted. For paths that must not write the source
 * record: a duplicate gets the merged arrangement while the SOURCE keeps its
 * stored order and updatedAt (portal#2274 P3 — the old path persisted the
 * merge to the source as a side effect). The source migrates for real the
 * next time it is applied. Returns the record unchanged on a no-op merge. */
export function migrateInView<T extends RowData>(
  table: PortalTable<T>,
  record: SavedViewRecord,
): SavedViewRecord {
  const columnOrder = mergeMissingColumns(defaultColumnOrder(table), record.view.columnOrder);
  if (columnOrder === record.view.columnOrder) return record;
  return { ...record, view: { ...record.view, columnOrder } };
}

/** Create a view from the table's current arrangement; first view becomes default. */
export async function createViewFrom<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  name: string,
  isFirst: boolean,
): Promise<SavedViewRecord> {
  const record = await store.create(listKey, name, extractTableView(table));
  if (isFirst) await store.setDefault(listKey, record.id);
  await store.setActiveId(listKey, record.id);
  return record;
}

/** Overwrite an existing view with the table's current arrangement. */
export async function overwriteView<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  id: string,
): Promise<void> {
  await store.update(listKey, id, { view: extractTableView(table) });
}

/** Apply a view to the table and mark it active. Migrates first, so selecting
 * a stored view that predates a column never appends the column at the end —
 * and RETURNS the migrated record, so the caller swaps the merged arrangement
 * into its own state without migrating a second time (portal#2274 P3). */
export async function applyAndActivate<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  view: SavedViewRecord,
): Promise<SavedViewRecord> {
  const migrated = await migrateStoredView(store, table, listKey, view);
  applyView(table, migrated.view);
  await store.setActiveId(listKey, view.id);
  return migrated;
}

/**
 * Delete a view and resolve the next state. If the deleted view was active,
 * fall back to the default view (apply it), else to the list's built-in
 * arrangement (table.reset()). Returns the refreshed views + new active id.
 */
export async function removeAndResolve<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  id: string,
  wasActive: boolean,
  currentActiveId: string | null,
): Promise<{ views: SavedViewRecord[]; activeId: string | null }> {
  await store.remove(listKey, id);
  let views = await store.list(listKey);
  if (!wasActive) return { views, activeId: currentActiveId };

  const defaultView = views.find((v) => v.isDefault) ?? null;
  if (defaultView) {
    const migrated = await migrateStoredView(store, table, listKey, defaultView);
    views = migrated !== defaultView ? views.map((v) => (v.id === migrated.id ? migrated : v)) : views;
    applyView(table, migrated.view);
    await store.setActiveId(listKey, migrated.id);
    return { views, activeId: migrated.id };
  }
  if ((table.options?.meta as { applyServerView?: unknown } | undefined)?.applyServerView) applyView(table, normalizeView(table.initialState));
  else table.reset(); // restore the built-in arrangement (spec US4)
  await store.setActiveId(listKey, null);
  return { views, activeId: null };
}

/**
 * Create a copy of a saved view (its stored arrangement, not the live state),
 * apply it to the table, and make it active — so the table matches the new
 * active view rather than leaving stale/tweaked live state behind.
 */
export async function duplicateView<T extends RowData>(
  store: ViewStore,
  table: PortalTable<T>,
  listKey: string,
  src: SavedViewRecord,
  name: string,
): Promise<SavedViewRecord> {
  // In-memory migration only: the copy carries the merged arrangement, but the
  // source record is not written — a duplicate is not an occasion to persist a
  // migration the caller's state can't see (portal#2274 P3). The source
  // migrates for real the next time it is applied.
  const migrated = migrateInView(table, src);
  const record = await store.create(listKey, name, migrated.view);
  applyView(table, record.view);
  await store.setActiveId(listKey, record.id);
  return record;
}
