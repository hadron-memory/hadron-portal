import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import TaskPlanning from './TaskPlanning.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
});
const choice = (i: number) => ({ id: `t${i}`, appId: 'app', title: `Task ${i}`, handle: `AT1.${i + 1}`, status: 'PENDING' });
const dependencies = () => ({ kind: 'ok' as const, value: {
  blockedBy: { items: Array.from({ length: 200 }, (_, i) => choice(i)), hasMore: true },
  blocks: { items: [], hasMore: false },
} });
async function setup() {
  setStubPage('http://localhost/app/apps/app/tasks/AT1?created=1');
  const props = reactiveProps({ task: { id: 'canonical', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies: dependencies() });
  const m = mountComponent(TaskPlanning as never, props as never);
  mounted.push(m);
  await tick(3);
  return { ...m, props };
}
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function more(target: HTMLElement) {
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Load more Waits for');
}

it('discloses concurrent deletion gaps after loading another page and offers a native current-URL reload', async () => {
  // Another reader removes t5 before offset200: t200 shifts to199 and is not returned.
  // The fixed offset contract cannot detect this gap; the view must not promise completeness.
  const changed = Array.from({ length: 205 }, (_, i) => choice(i)).filter((row) => row.id !== 't5');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: changed.slice(200), hasMore: false } })));
  const m = await setup();
  more(m.target)!.click();
  await tick(5);
  expect(m.target.textContent).toContain('Relations can change while you load pages. Reload this view to check the latest relations.');
  const reload = m.target.querySelector<HTMLAnchorElement>('a[data-sveltekit-reload]');
  expect(reload?.getAttribute('href')).toBe('/app/apps/app/tasks/AT1?created=1');
  expect(m.target.textContent).not.toContain('Load more in each direction');
});

it('offers reload rather than retrying the same shifted offset indefinitely', async () => {
  const fetcher = vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: [choice(0)], hasMore: true } }));
  vi.stubGlobal('fetch', fetcher);
  const m = await setup();
  more(m.target)!.click();
  await tick(5);
  expect(m.target.textContent).toContain('Relations changed while loading. Reload this view before loading more.');
  expect(m.target.textContent).not.toContain('Try again.');
  expect(more(m.target)).toBeUndefined();
  expect(m.target.querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves same-scope filter arrangement on refresh and retains table paging after filtering', async () => {
  const m = await setup();
  const input = m.target.querySelector<HTMLInputElement>('input[aria-label="Filter loaded relations…"]')!;
  input.value = 'Task 1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(3);
  m.props.dependencies = dependencies();
  await tick(3);
  expect(input.value).toBe('Task 1');
  const titles = () => Array.from(m.target.querySelectorAll('a[href*="/tasks/"]')).map((a) => a.textContent);
  expect(titles()).toContain('Task 1');
  const next = Array.from(m.target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Next');
  expect(next?.disabled).toBe(false);
  next!.click();
  await tick(3);
  expect(titles()).toContain('Task 19');
});
