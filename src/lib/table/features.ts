// The portal's TanStack Table v9 feature registry.
//
// v9 replaced v8's "pass a getXRowModel() per table" wiring with an explicit,
// tree-shakable feature set: you declare once which features and row models the
// app uses, and the bundler drops the rest. Every portal grid wants the SAME
// set, so it lives here and is pre-bound by `createSvelteTable` — call sites
// never mention features at all.
//
// Deliberately NOT registered (no portal grid uses them, and each one we leave
// out is dead code the bundler removes): grouping, aggregation, expanding,
// faceting, row selection, row pinning, column pinning.
//
// The `sortFns` / `filterFns` registries are included so column defs can keep
// naming built-ins as strings (`globalFilterFn: 'includesString'`). Swapping
// them for individual `sortFn_*` / `filterFn_*` imports would shave a little
// more bundle, at the cost of every string name becoming a compile error.

import {
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  type Cell,
  type CellData,
  type Column,
  type ColumnDef,
  type RowData,
  type Table,
  type TableOptions,
  type TableState,
} from '@tanstack/table-core';

export const features = tableFeatures({
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
});

/**
 * v9 threads the feature set through every generic (`ColumnDef<TFeatures,
 * TData>`). These aliases pin the first parameter to the portal's registry so
 * call sites stay single-generic, exactly as they read under v8.
 */
/**
 * Inject the shared registry into a caller's table options.
 *
 * Must copy property DESCRIPTORS, not values. Call sites pass reactive data as
 * a getter (`get data() { return rows; }`) so the adapter re-reads it whenever
 * the `$derived` source changes. A plain spread (`{ ...options, features }`)
 * would evaluate that getter once and freeze the table's data at creation —
 * a later invalidation would never reach the grid, and nothing would type-error.
 * This mirrors the `mergeObjects` the official adapter uses internally.
 */
export function withFeatures<TData extends RowData>(
  options: Omit<TableOptions<PortalFeatures, TData>, 'features'>,
): TableOptions<PortalFeatures, TData> {
  return Object.defineProperties({} as TableOptions<PortalFeatures, TData>, {
    ...Object.getOwnPropertyDescriptors(options),
    features: { value: features, enumerable: true, configurable: true },
  });
}

export type PortalFeatures = typeof features;
export type PortalColumnDef<TData extends RowData> = ColumnDef<PortalFeatures, TData>;
export type PortalTable<TData extends RowData> = Table<PortalFeatures, TData>;
export type PortalTableState = TableState<PortalFeatures>;
export type PortalCell<TData extends RowData, TValue extends CellData = CellData> = Cell<
  PortalFeatures,
  TData,
  TValue
>;
export type PortalColumn<TData extends RowData, TValue = unknown> = Column<
  PortalFeatures,
  TData,
  TValue
>;
