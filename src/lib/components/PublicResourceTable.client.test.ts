import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import PublicResourceTable from './PublicResourceTable.svelte';
import type { PublicResourceRef } from '$lib/types';

const resources = [
  { id: 'mem-1', name: 'Alpha handbook', urn: 'hrn:mem:public.test:alpha', description: 'Onboarding notes' },
  { id: 'mem-2', name: 'Beta reference', urn: 'hrn:mem:public.test:beta', description: 'API details' },
];

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

function mount(items: PublicResourceRef[] = resources) {
  mounted = mountComponent(PublicResourceTable as never, {
    page: { items, total: items.length, hasMore: false },
    offset: 0,
    prevHref: null,
    nextHref: null,
    firstHref: null,
    kind: 'memory',
    listKey: 'public-organization:memories:test',
  }) as Mounted<Record<string, unknown>>;
  return mounted;
}

describe('PublicResourceTable server pages', () => {
  it('keeps the served order and every served row despite a saved filter, sort, and page size', async () => {
    const listKey = 'public-organization:memories:test';
    localStorage.setItem(`hadron:views:v1:${listKey}`, JSON.stringify([{
      id: 'v1', listKey, name: 'Hide and reverse', isDefault: true,
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      view: {
        sorting: [{ id: 'name', desc: true }],
        columnFilters: [{ id: 'description', value: 'nothing matches' }],
        globalFilter: 'nothing matches', columnVisibility: {}, columnOrder: [], columnSizing: {},
        pagination: { pageIndex: 8, pageSize: 1 },
      },
    }]));
    const m = mount();
    await tick(5);
    const rows = [...m.target.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Alpha handbook');
    expect(rows[1].textContent).toContain('Beta reference');
    expect(m.target.querySelector('input')).toBeNull();
    expect(m.target.querySelector('select')).toBeNull();
    expect(m.target.querySelector('[aria-sort]')).toBeNull();
    expect(m.target.textContent).toContain('Showing 1–2 of 2');
  });

  it('renders all 205 served rows rather than introducing a second client page', async () => {
    const items = Array.from({ length: 205 }, (_, index) => ({
      id: `mem-${index}`,
      name: `Memory ${index}`,
      urn: `hrn:mem:public.test:memory-${index}`,
      description: null,
    }));
    const m = mount(items);
    await tick(3);
    const rows = [...m.target.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(205);
    expect(rows[0].textContent).toContain('Memory 0');
    expect(rows[204].textContent).toContain('Memory 204');
    expect(m.target.textContent).toContain('Showing 1–205 of 205');
    expect(m.target.querySelector('[data-testid="table-footer"]')).toBeNull();
  });
});
