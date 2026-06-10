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
  PaginationState,
  Table,
  RowData,
} from '@tanstack/table-core';

/** A persisted view: exactly the slices a user can customize. */
export interface SavedView {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  pagination: PaginationState;
}

/** Pull the persistable slices out of live table state. */
export function extractView(state: TableState): SavedView {
  return {
    sorting: state.sorting,
    columnFilters: state.columnFilters,
    globalFilter: typeof state.globalFilter === 'string' ? state.globalFilter : '',
    columnVisibility: state.columnVisibility,
    columnOrder: state.columnOrder,
    pagination: state.pagination,
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
  table.setPagination(view.pagination ?? { pageIndex: 0, pageSize: 25 });
}

/** Turn a saved view into a partial TableState usable as `initialState`. */
export function viewToInitialState(view: SavedView | null | undefined): Partial<TableState> {
  return view ? { ...view } : {};
}

export const serializeView = (view: SavedView): string => JSON.stringify(view);

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function validPagination(p: unknown): PaginationState {
  if (isObject(p) && typeof p.pageIndex === 'number' && typeof p.pageSize === 'number') {
    return { pageIndex: p.pageIndex, pageSize: p.pageSize };
  }
  return { pageIndex: 0, pageSize: 25 };
}

// Input may come from persisted storage or hand edits, so validate each slice's
// shape (array vs object, numeric pagination) and fall back to defaults rather
// than trust the JSON — a malformed slice would otherwise crash table consumers.
export function deserializeView(json: string): SavedView | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  return {
    sorting: Array.isArray(v.sorting) ? (v.sorting as SortingState) : [],
    columnFilters: Array.isArray(v.columnFilters) ? (v.columnFilters as ColumnFiltersState) : [],
    globalFilter: typeof v.globalFilter === 'string' ? v.globalFilter : '',
    columnVisibility: isObject(v.columnVisibility) ? (v.columnVisibility as VisibilityState) : {},
    columnOrder: Array.isArray(v.columnOrder) ? (v.columnOrder as ColumnOrderState) : [],
    pagination: validPagination(v.pagination),
  };
}
