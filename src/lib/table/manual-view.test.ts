import { describe, it, expect, vi } from 'vitest';
import { makeHeadlessTable } from './headlessTable';
import { applyView, normalizeView, extractTableView } from './savedView';

describe('server-owned saved-view state', () => {
  it('applies a manual view as one server intent, not local paging/sorting', () => {
    const applyServerView = vi.fn();
    const table = makeHeadlessTable({ data: [{ id: 'z' }, { id: 'a' }], columns: [{ accessorKey: 'id' }], manualPagination: true, manualSorting: true, meta: { applyServerView } });
    const view = normalizeView({ sorting: [{ id: 'id', desc: true }], columnFilters: [{ id: 'status', value: ['FAILED'] }], pagination: { pageIndex: 9, pageSize: 50 } });
    applyView(table, view);
    expect(applyServerView).toHaveBeenCalledExactlyOnceWith(view);
    expect(table.getRowModel().rows.map(r => r.original.id)).toEqual(['z', 'a']);
  });
  it('restores columns without overriding a URL-owned server slice on mount', () => {
    const applyServerView = vi.fn();
    const table = makeHeadlessTable({ data: [{ id: 'a' }], columns: [{ accessorKey: 'id' }], meta: { applyServerView } });
    const view = normalizeView({ columnVisibility: { id: false }, sorting: [{ id: 'id', desc: true }] });
    applyView(table, view, { columnsOnly: true });
    expect(applyServerView).not.toHaveBeenCalled(); expect(table.getColumn('id')?.getIsVisible()).toBe(false);
    expect(table.atoms.sorting.get()).toEqual([]);
  });
  it('captures server sorting and filters rather than the local placeholder state', () => {
    const serverView = { sorting: [{ id: 'createdAt', desc: true }], columnFilters: [{ id: 'status', value: ['FAILED'] }] };
    const table = makeHeadlessTable({ data: [], columns: [{ accessorKey: 'id' }], meta: { getServerView: () => serverView } });
    const saved = extractTableView(table);
    expect(saved.sorting).toEqual(serverView.sorting);
    expect(saved.columnFilters).toEqual(serverView.columnFilters);
  });

});
