/**
 * portal#2344 / #2377: the node picker's "Loading nodes…" line lives in a LiveRegion that
 * exists, empty, before the read, holds the text during it, and is the same element after.
 * The second page (Load more) is the reachable "before": the first read starts as the stage opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';
import SelectNode from './SelectNode.svelte';
import type { NodeChoice } from '$lib/node-choices';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

const node = (i: number): NodeChoice => ({ id: `n${i}`, name: `Node ${i}`, loc: `loc:${i}`, urn: `hrn:node:example.com:beta:loc:${i}` });
const page = (items: NodeChoice[], hasMore: boolean, nextOffset: number) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore, nextOffset } }) });
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

describe('SelectNode: loading line is a persistent live region (portal#2344)', () => {
  it('the region is empty before, holds the text during, and is the same element after', async () => {
    let finishSecond!: (v: unknown) => void;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('offset=0')) return Promise.resolve(page(Array.from({ length: 20 }, (_, i) => node(i)), true, 20));
      return new Promise((resolve) => { finishSecond = resolve; });
    });
    const m = mountComponent(SelectNode, { memories: [{ id: 'm2', name: 'Beta KB', urn: 'hrn:mem:example.com:beta' }], open: true, onselect: vi.fn() });
    mounted.push(m);
    await tick();
    const row = [...m.target.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Beta KB'))!;
    [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Select')!.click();
    await tick(5);
    const label = [...m.target.querySelectorAll('label')].find((l) => l.textContent?.includes('Search nodes'))!;
    const input = label.querySelector('input')!;
    input.value = 'node'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    button(m.target, 'Find')!.click();
    await tick(5);

    // BEFORE: the first page has landed; the loading region exists and says nothing.
    const regions = [...m.target.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => !r.textContent?.trim());
    expect(regions.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(m.target)).toBeNull();

    // DURING: Load more — the text lands in a region that already existed.
    button(m.target, 'Load more nodes')!.click();
    await tick(3);
    const during = announcedStatusRegion(m.target);
    expect(during?.textContent?.trim()).toBe('Loading nodes…');
    expect(regions).toContain(during);

    // AFTER: the same element, now empty.
    finishSecond(page([node(20)], false, 21));
    await tick(5);
    expect(during!.isConnected).toBe(true);
    expect(during!.textContent?.trim()).toBe('');
  });
});
