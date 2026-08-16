import { describe, it, expect } from 'vitest';
import { withFeatures } from './features';
import { makeHeadlessTable } from './headlessTable';

// Two regressions caught in review of the v8 -> v9 migration (#724). Both are
// invisible to the type checker, so they are pinned here.

describe('withFeatures (reactive option getters survive feature injection)', () => {
  // Call sites pass reactive data as a GETTER — `get data() { return rows; }`
  // — so the adapter re-reads it whenever the $derived source changes. A plain
  // object spread (`{ ...options, features }`) EVALUATES that getter once and
  // copies the resulting array, freezing the table's data at creation: any
  // later invalidation (SvelteKit `invalidate()`, a changed prop, a new
  // $derived value) would never reach the grid. The merge must copy property
  // DESCRIPTORS, not values.
  it('keeps `data` a live getter rather than snapshotting it', () => {
    let rows = [{ name: 'a' }];
    const merged = withFeatures({
      columns: [],
      get data() {
        return rows;
      },
    });

    expect(merged.data).toEqual([{ name: 'a' }]);

    rows = [{ name: 'b' }, { name: 'c' }];
    // Would still be [{name:'a'}] if the getter had been flattened to a value.
    expect(merged.data).toEqual([{ name: 'b' }, { name: 'c' }]);
  });

  it('still injects the portal feature registry', () => {
    const merged = withFeatures({ columns: [], data: [] });
    expect(merged.features).toBeDefined();
    expect(merged.features.rowSortingFeature).toBeDefined();
    // The Svelte adapter supplies rune reactivity; the shared registry must not
    // pin a coreReactivityFeature or it would override the adapter's.
    expect('coreReactivityFeature' in merged.features).toBe(false);
  });

  it('does not let the injected registry clobber an explicit one', () => {
    const merged = withFeatures({ columns: [], data: [], enableMultiSort: false });
    expect(merged.enableMultiSort).toBe(false);
  });
});

describe('row model choice for grids that render no pager', () => {
  // The shared registry enables rowPaginationFeature for EVERY grid, and v9
  // resolves `getRowModel()` to `getPaginatedRowModel()` with a default
  // pageSize of 10. Grids that deliberately show every row and render no
  // Prev/Next (NodeTable, AgentList — neither wired pagination under v8) must
  // therefore read the PRE-paginated model, or rows 11+ become unreachable.
  const DATA = Array.from({ length: 15 }, (_, i) => ({ name: `row-${i}`, nodeType: 'info' }));
  const columns = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'nodeType', header: 'Type' },
  ];

  it('getRowModel() truncates to the default page size', () => {
    const table = makeHeadlessTable<{ name: string; nodeType: string }>({ data: DATA, columns });
    expect(table.getRowModel().rows).toHaveLength(10);
  });

  it('getPrePaginatedRowModel() returns every row', () => {
    const table = makeHeadlessTable<{ name: string; nodeType: string }>({ data: DATA, columns });
    expect(table.getPrePaginatedRowModel().rows).toHaveLength(15);
  });

  it('the pre-paginated model still reflects sorting and filtering', () => {
    const table = makeHeadlessTable<{ name: string; nodeType: string }>({
      data: DATA,
      columns,
      globalFilterFn: 'includesString',
    });
    table.setGlobalFilter('row-1'); // row-1, row-10..row-14 => 6 rows
    table.setSorting([{ id: 'name', desc: true }]);

    const rows = table.getPrePaginatedRowModel().rows.map((r) => r.original.name);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe('row-14');
  });
});
