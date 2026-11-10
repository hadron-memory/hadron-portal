import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

function data(id: string, name: string) {
  return {
    organization: {
      id,
      name,
      urn: `hrn:org:${id}.test`,
      listedOnMarketplace: true,
      publicMemories: [
        { id: `${id}-mem`, name: `${name} Docs`, urn: `hrn:mem:${id}.test:docs`, description: null },
      ],
      publicAgents: [],
    },
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  localStorage.clear();
});

describe('/app/org/[id] client navigation (#1846 slice B)', () => {
  it('does not restore one organization\'s saved default filter into another organization', async () => {
    const listKey = 'public-organization:memories:org-a';
    localStorage.setItem(`hadron:views:v1:${listKey}`, JSON.stringify([{
      id: 'v1',
      listKey,
      name: 'Alpha only',
      view: {
        sorting: [], columnFilters: [], globalFilter: 'Alpha', columnVisibility: {},
        columnOrder: [], columnSizing: {}, pagination: { pageIndex: 0, pageSize: 20 },
      },
      isDefault: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }]));

    const props = reactiveProps<{ data: unknown }>({ data: data('org-a', 'Alpha') });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const box = () => m.target.querySelector<HTMLInputElement>('input[aria-label="Search public memories…"]')!;
    await vi.waitFor(() => expect(box().value).toBe('Alpha'));
    expect(m.target.textContent).toContain('Alpha Docs');

    props.data = data('org-b', 'Beta');
    await tick(5);
    expect(box().value).toBe('');
    expect(m.target.textContent).toContain('Beta Docs');
    expect(m.target.textContent).not.toContain('Alpha Docs');
  });
});
