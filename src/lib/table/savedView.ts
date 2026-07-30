// Saved "view" serialization for the unified data grid (TanStack side).
//
// The whole point of choosing TanStack: a view is just five plain-JSON state
// slices. Extract them from `table.getState()` to persist; feed them back as
// `initialState` (or controlled `state`) to rehydrate. No library-specific
// (de)serialization, no imperative get/applyColumnState calls — it's data.

import type {
  TableState,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  PaginationState,
  Table,
  RowData,
} from '@tanstack/table-core';

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
  columnVisibility: VisibilityState;
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
export function extractView(state: TableState): SavedView {
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

/**
 * Apply a saved view to a live table. Each slice is set independently; table-core
 * ignores ids that no longer exist (removed/renamed columns), so a stale view
 * never breaks the list (spec FR-013 / SC-005). Requires the table to have the
 * global-filter feature wired (all grid lists do).
 */
export function applyView<T extends RowData>(table: Table<T>, view: SavedView): void {
  table.setSorting(view.sorting ?? []);
  table.setColumnFilters(view.columnFilters ?? []);
  table.setGlobalFilter(view.globalFilter ?? '');
  table.setColumnVisibility(view.columnVisibility ?? {});
  table.setColumnOrder(view.columnOrder ?? []);
  table.setColumnSizing(view.columnSizing ?? {});
  // Land on the first page, keeping the view's page SIZE — see extractView.
  table.setPagination({ pageIndex: 0, pageSize: view.pagination?.pageSize ?? 25 });
}

/** Turn a saved view into a partial TableState usable as `initialState`. */
export function viewToInitialState(view: SavedView | null | undefined): Partial<TableState> {
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
    columnVisibility: isObject(o.columnVisibility) ? (o.columnVisibility as VisibilityState) : {},
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
