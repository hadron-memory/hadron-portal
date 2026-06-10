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
import { extractView, applyView, serializeView, deserializeView } from './savedView';
import type { SavedView } from './savedView';

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

  it('round-trips the global search term (spec 020 FR-002)', () => {
    const view: SavedView = {
      sorting: [],
      columnFilters: [],
      globalFilter: 'hello world',
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      pagination: { pageIndex: 0, pageSize: 25 },
    };
    expect(deserializeView(serializeView(view))!.globalFilter).toBe('hello world');
    // missing globalFilter defaults to ''
    expect(deserializeView('{}')!.globalFilter).toBe('');
  });

  it('extractView reads the global filter off table state', () => {
    const state = { globalFilter: 'q' } as unknown as TableState;
    expect(extractView({ ...state, sorting: [], columnFilters: [], columnVisibility: {}, columnOrder: [], pagination: { pageIndex: 0, pageSize: 10 } } as TableState).globalFilter).toBe('q');
  });
});

describe('applyView resilience (spec 020 FR-013 / SC-005)', () => {
  const view = (over: Partial<SavedView>): SavedView => ({
    sorting: [],
    columnFilters: [],
    globalFilter: '',
    columnVisibility: {},
    columnOrder: [],
    columnSizing: {},
    pagination: { pageIndex: 0, pageSize: 25 },
    ...over,
  });

  it('ignores unknown column/sort ids without throwing, applies the rest', () => {
    const table = makeTable();
    expect(() =>
      applyView(table, view({ sorting: [{ id: 'ghost', desc: false }], columnVisibility: { ghost: false }, pagination: { pageIndex: 0, pageSize: 5 } })),
    ).not.toThrow();
    // a valid slice (pagination) still applied; the list did not break
    expect(table.getState().pagination.pageSize).toBe(5);
    expect(table.getRowModel().rows.length).toBeGreaterThan(0);
  });

  it('applies a known sort', () => {
    const table = makeTable();
    applyView(table, view({ sorting: [{ id: 'name', desc: false }] }));
    expect(table.getRowModel().rows[0].original.name).toBe('Alice');
  });
});

describe('column visibility (ColumnToggle mechanism)', () => {
  function visTable() {
    let state = {} as TableState;
    const cols: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name', enableHiding: false }, // identity column
      { accessorKey: 'nodeType', header: 'Type' },
    ];
    const table = createTable<Row>({
      data: DATA,
      columns: cols,
      state,
      onStateChange: (u) => {
        state = u instanceof Function ? u(state) : u;
        table.setOptions((p) => ({ ...p, state }));
      },
      getCoreRowModel: getCoreRowModel(),
      renderFallbackValue: null,
    } as TableOptionsResolved<Row>);
    state = table.initialState;
    table.setOptions((p) => ({ ...p, state }));
    return table;
  }

  it('protects the identity column (enableHiding:false) and hides toggled columns', () => {
    const table = visTable();
    expect(table.getColumn('name')!.getCanHide()).toBe(false);
    expect(table.getColumn('nodeType')!.getCanHide()).toBe(true);

    table.getColumn('nodeType')!.toggleVisibility(false);
    expect(table.getVisibleLeafColumns().map((c) => c.id)).toEqual(['name']);
    // and it's reflected in the rendered cells
    expect(table.getRowModel().rows[0].getVisibleCells().map((c) => c.column.id)).toEqual(['name']);
  });
});
