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
} from '@tanstack/table-core';

/** A persisted view: exactly the slices a user can customize. */
export interface SavedView {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  pagination: PaginationState;
}

/** Pull the persistable slices out of live table state. */
export function extractView(state: TableState): SavedView {
  return {
    sorting: state.sorting,
    columnFilters: state.columnFilters,
    columnVisibility: state.columnVisibility,
    columnOrder: state.columnOrder,
    pagination: state.pagination,
  };
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
    columnVisibility: isObject(v.columnVisibility) ? (v.columnVisibility as VisibilityState) : {},
    columnOrder: Array.isArray(v.columnOrder) ? (v.columnOrder as ColumnOrderState) : [],
    pagination: validPagination(v.pagination),
  };
}
