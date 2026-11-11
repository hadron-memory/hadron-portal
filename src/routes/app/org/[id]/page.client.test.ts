import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

function data(id: string, name: string, memoriesOffset = 0) {
  return {
    organization: {
      id,
      name,
      urn: `hrn:org:${id}.test`,
      listedOnMarketplace: true,
      publicMemoriesPage: {
        items: Array.from({ length: memoriesOffset === 0 ? 20 : 1 }, (_, index) => ({
          id: `${id}-mem-${index}`,
          name: index === 0 ? `${name} Docs` : `${name} Docs ${index + 1}`,
          urn: `hrn:mem:${id}.test:docs-${index}`,
          description: null,
        })),
        total: 21,
        hasMore: memoriesOffset === 0,
      },
      publicAgentsPage: { items: [], total: 0, hasMore: false },
    },
    paging: { memories: { limit: 20, offset: memoriesOffset }, agents: { limit: 20, offset: 0 } },
    path: `/app/org/${id}`,
    search: memoriesOffset ? `?memoriesOffset=${memoriesOffset}` : '',
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  localStorage.clear();
});

describe('/app/org/[id] client navigation (#1846 slice B)', () => {
  it('replaces keyed organization state and served rows on a late A-to-B prop update', async () => {
    const props = reactiveProps<{ data: unknown }>({ data: data('org-a', 'Alpha') });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.textContent).toContain('Alpha Docs');

    props.data = data('org-b', 'Beta', 20);
    await tick(5);
    expect(m.target.textContent).toContain('Beta Docs');
    expect(m.target.textContent).not.toContain('Alpha Docs');
    expect(m.target.textContent).toContain('Showing 21–21 of 21');
    expect(m.target.querySelector<HTMLAnchorElement>('a[rel="prev"]')?.getAttribute('href')).toBe('/app/org/org-b');
    expect(m.target.querySelector('a[rel="next"]')).toBeNull();
  });

  it('replaces rows and native links when only the current page changes', async () => {
    const props = reactiveProps<{ data: unknown }>({ data: data('org-a', 'First') });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    props.data = data('org-a', 'Second', 20);
    await tick(5);
    expect(m.target.textContent).toContain('Second Docs');
    expect(m.target.textContent).not.toContain('First Docs');
    expect(m.target.querySelector<HTMLAnchorElement>('a[rel="prev"]')?.getAttribute('href')).toBe('/app/org/org-a');
    expect(m.target.querySelector('a[rel="next"]')).toBeNull();
  });
});
