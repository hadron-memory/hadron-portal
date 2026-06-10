import { describe, it, expect } from 'vitest';
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type TableState,
  type TableOptionsResolved,
  type ColumnDef,
} from '@tanstack/table-core';
import { extractView, serializeView, deserializeView } from './savedView';

// The bake-off's testability claim: with TanStack the table BEHAVIOR
// (sort/filter/paginate) and the saved-view (de)serialization are plain logic
// over data — testable in node with no DOM, no browser, no component harness.
// (The AG Grid equivalent requires a real browser/grid instance.)

interface Row {
  name: string;
  nodeType: string;
}

const DATA: Row[] = [
  { name: 'Charlie', nodeType: 'task' },
  { name: 'Alice', nodeType: 'info' },
  { name: 'Bob', nodeType: 'info' },
  { name: 'Dave', nodeType: 'task' },
  { name: 'Eve', nodeType: 'data' },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'nodeType', header: 'Type' },
];

/** Headless table with self-fed state — mirrors what the runes adapter does. */
function makeTable() {
  let state = {} as TableState;
  const table = createTable<Row>({
    data: DATA,
    columns,
    state,
    onStateChange: (updater) => {
      state = updater instanceof Function ? updater(state) : updater;
      table.setOptions((prev) => ({ ...prev, state }));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    renderFallbackValue: null,
  } as TableOptionsResolved<Row>);
  state = table.initialState;
  table.setOptions((prev) => ({ ...prev, state }));
  return table;
}

describe('TanStack table logic (headless, no DOM)', () => {
  it('sorts by a column', () => {
    const table = makeTable();
    table.setSorting([{ id: 'name', desc: false }]);
    expect(table.getRowModel().rows.map((r) => r.original.name)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
      'Dave',
      'Eve',
    ]);
  });

  it('filters with a global filter', () => {
    const table = makeTable();
    table.setOptions((prev) => ({ ...prev, globalFilterFn: 'includesString' }));
    table.setGlobalFilter('info');
    // globalFilter scans all columns; 'info' matches the two nodeType=info rows.
    expect(table.getRowModel().rows.map((r) => r.original.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('paginates', () => {
    const table = makeTable();
    table.setPageSize(2);
    expect(table.getRowModel().rows).toHaveLength(2);
    expect(table.getPageCount()).toBe(3);
    table.nextPage();
    expect(table.getState().pagination.pageIndex).toBe(1);
  });
});

describe('saved-view serialization', () => {
  it('round-trips a view through JSON', () => {
    const table = makeTable();
    table.setSorting([{ id: 'name', desc: true }]);
    table.setColumnVisibility({ nodeType: false });
    table.setPageSize(10);

    const json = serializeView(extractView(table.getState()));
    const restored = deserializeView(json);

    expect(restored).not.toBeNull();
    expect(restored!.sorting).toEqual([{ id: 'name', desc: true }]);
    expect(restored!.columnVisibility).toEqual({ nodeType: false });
    expect(restored!.pagination.pageSize).toBe(10);
  });

  it('deserialize tolerates garbage', () => {
    expect(deserializeView('not json{')).toBeNull();
  });

  it('deserialize rejects non-object JSON (null, array, primitive)', () => {
    expect(deserializeView('null')).toBeNull();
    expect(deserializeView('[]')).toBeNull();
    expect(deserializeView('42')).toBeNull();
  });

  it('deserialize falls back to defaults for malformed slices', () => {
    const v = deserializeView('{"sorting":"oops","pagination":"nope","columnVisibility":[]}');
    expect(v).not.toBeNull();
    expect(v!.sorting).toEqual([]);
    expect(v!.columnVisibility).toEqual({});
    expect(v!.pagination).toEqual({ pageIndex: 0, pageSize: 25 });
  });
});
