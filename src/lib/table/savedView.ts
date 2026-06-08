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

export function deserializeView(json: string): SavedView | null {
  try {
    const v = JSON.parse(json) as Partial<SavedView>;
    return {
      sorting: v.sorting ?? [],
      columnFilters: v.columnFilters ?? [],
      columnVisibility: v.columnVisibility ?? {},
      columnOrder: v.columnOrder ?? [],
      pagination: v.pagination ?? { pageIndex: 0, pageSize: 25 },
    };
  } catch {
    return null;
  }
}
