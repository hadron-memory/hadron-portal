import { describe, it, expect } from 'vitest';
import { makeHeadlessTable } from '$lib/table/headlessTable';
import type { PortalColumnDef, PortalTableState } from '$lib/table/features';
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

const columns: PortalColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'nodeType', header: 'Type' },
];

/**
 * Headless table. Under v8 this hand-fed state back through `setOptions` on
 * every change, because table-core was fully controlled. v9 owns its state
 * internally (base atoms), so construction is just the options object — the
 * same shape the Svelte adapter passes.
 */
function makeTable() {
  return makeHeadlessTable<Row>({ data: DATA, columns });
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
    expect(table.atoms.pagination.get().pageIndex).toBe(1);
  });
});

// Date columns must sort by INSTANT, not by the raw wire string. The `DateTime`
// scalar only guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC —
// so a provider pass-through value can carry a non-UTC offset. Handed a date
// string, TanStack auto-selects its `alphanumeric` comparator, which orders by
// the wall-clock digit groups and IGNORES the offset entirely, so two rows an
// hour apart can come out in the wrong order. Every portal date column therefore
// uses an `accessorFn` returning epoch millis (with the rendered text produced
// separately at display time).
describe('date-column sorting (DateTime scalar is only Date.parse-able)', () => {
  interface Ev {
    label: string;
    at: string;
  }

  // Same calendar day, three different offsets. Chronologically it is
  // B (21:00Z) → A (22:00Z) → C (23:00Z), but the wall-clock hours are
  // C=18, A=22, B=23 — so offset-blind ordering yields C → A → B instead.
  const EVENTS: Ev[] = [
    { label: 'A', at: '2026-07-30T22:00:00Z' }, // 22:00Z
    { label: 'B', at: '2026-07-30T23:00:00+02:00' }, // 21:00Z
    { label: 'C', at: '2026-07-30T18:00:00-05:00' }, // 23:00Z
  ];

  function dateTable(col: PortalColumnDef<Ev>) {
    const table = makeHeadlessTable<Ev>({
      data: EVENTS,
      columns: [{ accessorKey: 'label', header: 'Label' }, col],
    });
    table.setSorting([{ id: 'at', desc: false }]);
    return table;
  }

  it('sorts chronologically with a numeric (epoch-millis) accessor', () => {
    const table = dateTable({
      accessorFn: (r) => new Date(r.at).getTime(),
      id: 'at',
      header: 'When',
    });
    expect(table.getRowModel().rows.map((r) => r.original.label)).toEqual(['B', 'A', 'C']);
  });

  it('pins the defect: a raw-string accessor orders by wall clock, ignoring the offset', () => {
    const table = dateTable({ accessorKey: 'at', id: 'at', header: 'When' });
    expect(table.getRowModel().rows.map((r) => r.original.label)).toEqual(['C', 'A', 'B']);
  });

  it('keeps missing/unparseable dates out of the ordering as null', () => {
    const ms = (val: string | null): number | null => {
      if (!val) return null;
      const t = new Date(val).getTime();
      return isNaN(t) ? null : t;
    };
    expect(ms(null)).toBeNull();
    expect(ms('not a date')).toBeNull();
    expect(ms('2026-07-30T23:00:00+02:00')).toBe(Date.parse('2026-07-30T21:00:00Z'));
  });
});

describe('saved-view serialization', () => {
  it('round-trips a view through JSON', () => {
    const table = makeTable();
    table.setSorting([{ id: 'name', desc: true }]);
    table.setColumnVisibility({ nodeType: false });
    table.setPageSize(10);

    const json = serializeView(extractView(table.store.get()));
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

  // Codex review on #677: a view saved on page 5 and later applied to a
  // SMALLER row set (a different server-side slice, a later page, fewer rows)
  // used to slice past the end — blank body on a non-empty list, and no pager
  // to escape with. pageSize is a preference; the page NUMBER is not.
  describe('pageIndex is never part of a view', () => {
    const asView = (over: Partial<SavedView>): SavedView => ({
      sorting: [],
      columnFilters: [],
      globalFilter: '',
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      pagination: { pageIndex: 0, pageSize: 25 },
      ...over,
    });

    it('extractView pins pageIndex to 0 but keeps pageSize', () => {
      const table = makeTable();
      table.setPageSize(2);
      table.nextPage();
      expect(table.atoms.pagination.get().pageIndex).toBe(1);

      expect(extractView(table.store.get()).pagination).toEqual({ pageIndex: 0, pageSize: 2 });
    });

    it('paging does not make the live state differ from its saved view', () => {
      const table = makeTable();
      table.setPageSize(2);
      const saved = extractView(table.store.get());
      table.nextPage();

      // What isModified() compares — paging must not pop Save/Reset.
      expect(serializeView(extractView(table.store.get()))).toBe(serializeView(saved));
    });

    it('applyView lands on the first page even from a stale stored pageIndex', () => {
      const table = makeTable();
      table.setPageSize(2);
      table.nextPage();

      applyView(table, asView({ pagination: { pageIndex: 4, pageSize: 2 } }));

      expect(table.atoms.pagination.get()).toEqual({ pageIndex: 0, pageSize: 2 });
      // The row model must actually have rows — the bug was a blank body.
      expect(table.getRowModel().rows.length).toBeGreaterThan(0);
    });

    it('normalizes a legacy stored pageIndex on read', () => {
      const v = deserializeView('{"pagination":{"pageIndex":7,"pageSize":10}}');
      expect(v!.pagination).toEqual({ pageIndex: 0, pageSize: 10 });
    });
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
    const state = { globalFilter: 'q' } as unknown as PortalTableState;
    expect(extractView({ ...state, sorting: [], columnFilters: [], columnVisibility: {}, columnOrder: [], pagination: { pageIndex: 0, pageSize: 10 } } as PortalTableState).globalFilter).toBe('q');
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
    expect(table.atoms.pagination.get().pageSize).toBe(5);
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
    const cols: PortalColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name', enableHiding: false }, // identity column
      { accessorKey: 'nodeType', header: 'Type' },
    ];
    return makeHeadlessTable<Row>({ data: DATA, columns: cols });
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
