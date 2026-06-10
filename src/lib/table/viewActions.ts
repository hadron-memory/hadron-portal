// Pure (runes-free) orchestration for saved-view actions. The runes controller
// delegates to these so the meaningful behavior is unit-testable in node with a
// fake ViewStore + a minimal table stub (the project's vitest runs without the
// Svelte plugin, so `*.svelte.ts` runes modules can't be instantiated in tests).
import type { Table, RowData } from '@tanstack/table-core';
import { extractView, applyView } from './savedView';
import type { ViewStore, SavedViewRecord } from './viewStore';

/** Create a view from the table's current arrangement; first view becomes default. */
export async function createViewFrom<T extends RowData>(
  store: ViewStore,
  table: Table<T>,
  listKey: string,
  name: string,
  isFirst: boolean,
): Promise<SavedViewRecord> {
  const record = await store.create(listKey, name, extractView(table.getState()));
  if (isFirst) await store.setDefault(listKey, record.id);
  await store.setActiveId(listKey, record.id);
  return record;
}

/** Overwrite an existing view with the table's current arrangement. */
export async function overwriteView<T extends RowData>(
  store: ViewStore,
  table: Table<T>,
  listKey: string,
  id: string,
): Promise<void> {
  await store.update(listKey, id, { view: extractView(table.getState()) });
}

/** Apply a view to the table and mark it active. */
export async function applyAndActivate<T extends RowData>(
  store: ViewStore,
  table: Table<T>,
  listKey: string,
  view: SavedViewRecord,
): Promise<void> {
  applyView(table, view.view);
  await store.setActiveId(listKey, view.id);
}

/**
 * Delete a view and resolve the next state. If the deleted view was active,
 * fall back to the default view (apply it), else to the list's built-in
 * arrangement (table.reset()). Returns the refreshed views + new active id.
 */
export async function removeAndResolve<T extends RowData>(
  store: ViewStore,
  table: Table<T>,
  listKey: string,
  id: string,
  wasActive: boolean,
  currentActiveId: string | null,
): Promise<{ views: SavedViewRecord[]; activeId: string | null }> {
  await store.remove(listKey, id);
  const views = await store.list(listKey);
  if (!wasActive) return { views, activeId: currentActiveId };

  const def = views.find((v) => v.isDefault) ?? null;
  if (def) {
    applyView(table, def.view);
    await store.setActiveId(listKey, def.id);
    return { views, activeId: def.id };
  }
  table.reset(); // restore the built-in arrangement (spec US4)
  await store.setActiveId(listKey, null);
  return { views, activeId: null };
}
