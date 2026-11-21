/**
 * portal#2344 / #2377: the task picker's "Loading tasks…" line lives in a LiveRegion that exists,
 * empty, before a read, holds the text during it, and is the same element after. The first read
 * starts as the dialog opens, so Load more is the reachable "before".
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';
import SelectTask from './SelectTask.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Title ${id}`, handle: 'AT1.2', status: 'PENDING' });
const answer = (items: unknown[], hasMore: boolean) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore } }) });

it('the loading region is empty before, holds the text during, and is the same element after', async () => {
  let finishSecond!: (v: unknown) => void;
  const fetch = vi.fn().mockResolvedValueOnce(answer(Array.from({ length: 200 }, (_, i) => choice(String(i))), true))
    .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const m = mountComponent(SelectTask, { appId: 'app', open: true, onselect: vi.fn() });
  mounted.push(m);
  await tick(5);

  const regions = [...m.target.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => !r.textContent?.trim());
  expect(regions.length).toBeGreaterThan(0); // BEFORE: exists, empty
  expect(announcedStatusRegion(m.target)).toBeNull();

  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Load more tasks')!.click();
  await tick(3);
  const during = announcedStatusRegion(m.target);
  expect(during?.textContent?.trim()).toBe('Loading tasks…'); // DURING
  expect(regions).toContain(during);

  finishSecond(answer([choice('201')], false));
  await tick(5);
  expect(during!.isConnected).toBe(true); // AFTER: same element, empty
  expect(during!.textContent?.trim()).toBe('');
});
