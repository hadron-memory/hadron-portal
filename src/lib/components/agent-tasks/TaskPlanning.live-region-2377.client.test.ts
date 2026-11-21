import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import TaskPlanning from './TaskPlanning.svelte';

/** portal#2344 / #2377 slice 4: the 'Loading Waits for…' / 'Loading Holds up…' lines are persistent live regions. */
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
const first = () => ({ kind: 'ok' as const, value: {
  blockedBy: { items: Array.from({ length: 200 }, (_, i) => choice(String(i))), hasMore: true },
  blocks: { items: Array.from({ length: 200 }, (_, i) => choice(`b${i}`)), hasMore: true },
} });
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe.each([
  ['Load more Waits for', 'Loading Waits for…'],
  ['Load more Holds up', 'Loading Holds up…'],
])('%s', (buttonLabel, loadingText) => {
  it('the loading line is announced by a region that exists empty before, holds the text during, and is the same element after', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const props = reactiveProps({ task: { id: 'task', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies: first() });
    const m = mountComponent(TaskPlanning as never, props as never); mounted.push(m); await tick(3);
    const btn = Array.from(m.target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === buttonLabel)!;
    const region = btn.parentElement!.querySelector<HTMLElement>('[role="status"]')!;
    expect(region, 'the region exists before the read').not.toBeNull();
    expect(region.textContent?.trim()).toBe('');
    expect(idleStatusRegions(m.target)).toContain(region);

    btn.click(); await tick(3);
    expect(region.textContent?.trim()).toBe(loadingText);

    resolve(reply({ kind: 'ok', value: { items: [choice('later')], hasMore: false } })); await tick(5);
    expect(region.isConnected).toBe(true);
    expect(region.textContent?.trim()).toBe('');
  });
});
