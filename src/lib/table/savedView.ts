// Saved "view" serialization for the unified data grid (TanStack side).
//
// The whole point of choosing TanStack: a view is just five plain-JSON state
// slices. Extract them from `table.store.get()` to persist; feed them back as
// `initialState` (or controlled `state`) to rehydrate. No library-specific
// (de)serialization, no imperative get/applyColumnState calls — it's data.

import type { PortalTable, PortalTableState } from '$lib/table/features';
import type { SortingState, ColumnFiltersState, ColumnVisibilityState, ColumnOrderState, ColumnSizingState, PaginationState, RowData } from '@tanstack/table-core';

/**
 * A persisted view: exactly the slices a user can customize.
 *
 * `pagination.pageIndex` is deliberately NOT part of a view — see
 * `extractView`. Only `pageSize` is a user preference; the page NUMBER is
 * ephemeral position. The field stays in the shape (it's `PaginationState`)
 * but is always normalized to 0.
 */
export interface SavedView {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  columnVisibility: ColumnVisibilityState;
  columnOrder: ColumnOrderState;
  columnSizing: ColumnSizingState;
  pagination: PaginationState;
}

/**
 * Pull the persistable slices out of live table state.
 *
 * `pageIndex` is pinned to 0 rather than captured (Codex review on #677). Two
 * reasons, both bugs:
 *
 * 1. **Restoring a stale page can strand the user.** A view saved on page 5
 *    that is later applied to a SMALLER row set — a different server-side
 *    slice (`?status=FAILED`), a later server page, or just fewer rows —
 *    leaves `getPaginationRowModel()` slicing past the end. The body renders
 *    blank while the list is non-empty (so the page's empty state doesn't
 *    show either), and `DataTable` hides Prev/Next at a single page, so
 *    there's no way back.
 * 2. **Paging would mark the view "modified".** `isModified` compares
 *    `extractView(live)` against the stored view, so clicking Next used to
 *    pop the Save/Reset buttons for what isn't an arrangement change at all.
 *
 * `pageSize` IS a real preference and is preserved.
 */
export function extractView(state: PortalTableState): SavedView {
  return {
    sorting: state.sorting,
    columnFilters: state.columnFilters,
    globalFilter: typeof state.globalFilter === 'string' ? state.globalFilter : '',
    columnVisibility: state.columnVisibility,
    columnOrder: state.columnOrder,
    columnSizing: state.columnSizing,
    pagination: { pageIndex: 0, pageSize: state.pagination.pageSize },
  };
}

/** A server table can own sort/filter values without exposing synthetic columns. */
export function extractTableView<T extends RowData>(table: PortalTable<T>): SavedView {
  const base = extractView(table.store.get());
  const server = (table.options?.meta as { getServerView?: () => Pick<SavedView, 'sorting' | 'columnFilters'> } | undefined)?.getServerView?.();
  return server ? { ...base, ...server } : base;
}

/**
 * Apply a saved view to a live table. Each slice is set independently; table-core
 * ignores ids that no longer exist (removed/renamed columns), so a stale view
 * never breaks the list (spec FR-013 / SC-005). Requires the table to have the
 * global-filter feature wired (all grid lists do).
 */
export function applyView<T extends RowData>(table: PortalTable<T>, view: SavedView, options: { columnsOnly?: boolean; initial?: boolean } = {}): void {
  const server = (table.options?.meta as { applyServerView?: (view: SavedView, options?: { initial?: boolean }) => void } | undefined)?.applyServerView;
  if (!options.columnsOnly) {
    if (server) {
      if (options.initial) server(view, { initial: true });
      else server(view);
    }
    else {
      table.setSorting(view.sorting ?? []);
      table.setColumnFilters(view.columnFilters ?? []);
      table.setGlobalFilter(view.globalFilter ?? '');
    }
  }
  table.setColumnVisibility(view.columnVisibility ?? {});
  table.setColumnOrder(view.columnOrder ?? []);
  table.setColumnSizing(view.columnSizing ?? {});
  // Land on the first page, keeping the view's page SIZE — see extractView.
  if (!options.columnsOnly && !server) table.setPagination({ pageIndex: 0, pageSize: view.pagination?.pageSize ?? 25 });
}

/**
 * Merge a saved column order with the list's current default order
 * (portal#2253 item 4): ids the saved order does not name (columns added after
 * the view was saved) enter at their DEFAULT position — immediately after the
 * closest preceding default-order id, including one merged in by an earlier
 * iteration (so several new columns keep their default relative order) —
 * instead of table-core's bare append at the far end, where a deadline column
 * lands past the fold and reads as clipped. A missing id with NO surviving
 * predecessor at all (a column added before everything else) enters at the
 * front, its default position.
 *
 * An EMPTY saved order stays empty: it means "natural order", which already
 * self-updates as columns are added, and freezing it into an explicit list
 * would pin today's arrangement on a user who never dragged anything. Ids the
 * table no longer knows are preserved in place (inert, and table-core ignores
 * them) so the merge never discards a user's arrangement.
 */
export function mergeMissingColumns(
  defaultOrder: readonly string[],
  saved: ColumnOrderState,
): ColumnOrderState {
  if (!saved.length) return saved;
  const present = new Set(saved);
  const missing = defaultOrder.filter((id) => !present.has(id));
  if (!missing.length) return saved;
  const out = [...saved];
  for (const id of missing) {
    let anchor = -1;
    for (let i = defaultOrder.indexOf(id) - 1; i >= 0; i--) {
      const at = out.indexOf(defaultOrder[i]!);
      if (at !== -1) { anchor = at; break; }
    }
    out.splice(anchor + 1, 0, id);
  }
  return out;
}

/** Turn a saved view into a partial PortalTableState usable as `initialState`. */
export function viewToInitialState(view: SavedView | null | undefined): Partial<PortalTableState> {
  return view
    ? { ...view, pagination: { pageIndex: 0, pageSize: view.pagination?.pageSize ?? 25 } }
    : {};
}

export const serializeView = (view: SavedView): string => JSON.stringify(view);

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// pageIndex is normalized to 0 on the way IN too, so a legacy view stored
// before that rule (or a hand-edited one) compares equal to freshly-extracted
// state instead of reading as permanently "modified".
function validPagination(p: unknown): PaginationState {
  if (isObject(p) && typeof p.pageSize === 'number') {
    return { pageIndex: 0, pageSize: p.pageSize };
  }
  return { pageIndex: 0, pageSize: 25 };
}

// Input may come from persisted storage or hand edits, so validate each slice's
// shape (array vs object, numeric pagination) and fall back to defaults rather
// than trust the JSON — a malformed slice would otherwise crash table consumers.
/**
 * Coerce a possibly-partial/legacy view object into a complete SavedView,
 * defaulting any missing slice. Critical for forward-compat: an older stored
 * view (e.g. saved before `columnSizing` existed) must normalize to the full
 * shape, or it would always compare as "modified" against current state.
 */
export function normalizeView(v: unknown): SavedView {
  const o = isObject(v) ? v : {};
  return {
    sorting: Array.isArray(o.sorting) ? (o.sorting as SortingState) : [],
    columnFilters: Array.isArray(o.columnFilters) ? (o.columnFilters as ColumnFiltersState) : [],
    globalFilter: typeof o.globalFilter === 'string' ? o.globalFilter : '',
    columnVisibility: isObject(o.columnVisibility) ? (o.columnVisibility as ColumnVisibilityState) : {},
    columnOrder: Array.isArray(o.columnOrder) ? (o.columnOrder as ColumnOrderState) : [],
    columnSizing: isObject(o.columnSizing) ? (o.columnSizing as ColumnSizingState) : {},
    pagination: validPagination(o.pagination),
  };
}

export function deserializeView(json: string): SavedView | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  return normalizeView(v);
}
