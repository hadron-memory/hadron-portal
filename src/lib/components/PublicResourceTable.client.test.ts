import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import PublicResourceTable from './PublicResourceTable.svelte';

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

async function search(value: string) {
  const input = mounted!.target.querySelector<HTMLInputElement>('input[aria-label="Search public memories…"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}

describe('PublicResourceTable global search', () => {
  it.each([
    ['name', 'Alpha handbook'],
    ['URN', 'hrn:mem:public.test:alpha'],
    ['description', 'Onboarding notes'],
  ])('finds the row by its rendered %s and excludes the non-match', async (_label, needle) => {
    mounted = mountComponent(PublicResourceTable as never, {
      resources,
      kind: 'memory',
      listKey: 'public-organization:memories:test',
    });
    await tick(2);
    expect(mounted.target.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(mounted.target.querySelector('table')?.style.width).toBe('max(100%, 220px)');
    const descriptionCell = mounted.target.querySelector('tbody tr td:nth-child(2) > div');
    expect(descriptionCell?.classList.contains('break-words')).toBe(true);
    expect(descriptionCell?.classList.contains('truncate')).toBe(false);

    await search(needle);
    expect(mounted.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(mounted.target.textContent).toContain('Alpha handbook');
    expect(mounted.target.textContent).not.toContain('Beta reference');
  });
});
