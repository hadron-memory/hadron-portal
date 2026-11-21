/**
 * portal#2344 / #2377: the revision page's 'Loading changes…' line is announced by one region.
 * The page streams `changes`, so the first load is already loading at mount; the pin therefore
 * moves to a second revision (a new pending promise) to see the region empty, populated and
 * empty again as the SAME element.
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import Page from './+page.svelte';

const revision = (name: string) => ({
  id: `rev-${name}`, name, loc: `notes:${name}`, revNo: 3, revLabel: null, description: null, tags: [], content: 'body',
  createdAt: '2026-08-01T10:00:00.000Z', editedByUser: null, editedByInfo: null,
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const settled = { ok: true, against: 'unknown' } as const;
const data = (name: string, changes: Promise<unknown>) => ({
  revision: revision(name), provenance: new Promise(() => {}), changes, memoryId: 'mem-1', nodeId: 'node-1',
});

let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  m?.unmount();
  m = undefined;
});
const region = (target: HTMLElement) =>
  [...target.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes('Loading changes…')) ?? null;

it("'Loading changes…' is one region: empty after the first read, speaking during the next, then empty", async () => {
  const props = reactiveProps({ data: data('a', Promise.resolve(settled)) } as Record<string, unknown>);
  m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await wait(0); await tick(3);
  expect(region(m.target)).toBeNull();
  const idle = idleStatusRegions(m.target);
  expect(idle.length, 'a region already exists, empty').toBeGreaterThan(0);

  const next = deferred<unknown>();
  props.data = data('b', next.promise);
  await tick(3);
  const during = region(m.target);
  expect(during, 'the line is announced').not.toBeNull();
  expect(idle).toContain(during);

  next.resolve(settled);
  await wait(0); await tick(3);
  expect(region(m.target)).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe('');
});
