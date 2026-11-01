import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import TaskPlanning from './TaskPlanning.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); resetNavigationCalls(); });
const choice = (id: string, appId = 'app') => ({ id, appId, title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
const first = () => ({ kind: 'ok' as const, value: {
  blockedBy: { items: Array.from({ length: 200 }, (_, i) => choice(String(i))), hasMore: true },
  blocks: { items: Array.from({ length: 200 }, (_, i) => choice(`b${i}`)), hasMore: true },
} });
async function setup() {
  const props = reactiveProps({ task: { id: 'task', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies: first() });
  const m = mountComponent(TaskPlanning as never, props as never); mounted.push(m); await tick(3);
  return { ...m, props };
}
function button(target: HTMLElement, label: string) {
  const b = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label);
  expect(b, label).toBeDefined(); return b!;
}
function filter(target: HTMLElement, query: string) {
  const input = target.querySelector<HTMLInputElement>('input[aria-label="Filter loaded relations…"]')!;
  input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
}
function deferred() { let resolve!: (value: Response) => void; return { promise: new Promise<Response>((r) => resolve = r), resolve: (body: unknown) => resolve(new Response(JSON.stringify(body))) }; }

describe('relation forward pages', () => {
  it('reads beyond 200 independently in both directions and removes a later blocker then refreshes', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const direction = new URL(url, 'http://localhost').searchParams.get('direction');
      return new Response(JSON.stringify({ kind: 'ok', value: { items: [choice(direction === 'blockedBy' ? 'later' : 'held')], hasMore: false } }));
    });
    vi.stubGlobal('fetch', fetcher); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick(5);
    button(m.target, 'Load more Holds up').click(); await tick(5);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      '/app/apps/app/tasks/task/relations?direction=blockedBy&offset=200',
      '/app/apps/app/tasks/task/relations?direction=blocks&offset=200',
    ]);
    filter(m.target, 'Task later'); await tick(3);
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/removeBlocker"]')!;
    expect(form?.querySelector<HTMLInputElement>('input[name="blockerTaskRef"]')?.value).toBe('later');
    navigationHooks.onInvalidateAll = () => { m.props.dependencies = { kind: 'ok', value: { blockedBy: { items: [], hasMore: false }, blocks: { items: [choice('held')], hasMore: false } } }; };
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: {} }); await tick(5);
    expect(m.target.textContent).toContain('Saved. Facts refreshed.');
    expect(m.target.querySelector('input[value="later"]')).toBeNull();
    filter(m.target, 'Task held'); await tick(3);
    expect(m.target.textContent).toContain('Task held');
    expect(m.target.querySelector('form[action="?/removeBlocker"]')).toBeNull();
  });
  it('retains loaded rows on a failed next page and retries the same offset, never claims empty', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('private fault')).mockResolvedValue(new Response(JSON.stringify({ kind: 'ok', value: { items: [choice('later')], hasMore: false } })));
    vi.stubGlobal('fetch', fetcher); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more Waits for. Try again.');
    expect(m.target.textContent).toContain('Task 0'); expect(m.target.textContent).not.toContain('private fault');
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
    expect(m.target.textContent).not.toContain('Couldn’t load more Waits for. Try again.');
  });
  it.each(['task', 'app', 'destroy'])('discards a pending page after %s changes', async (change) => {
    const hold = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise)); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick();
    if (change === 'task') m.props.task = { ...m.props.task, id: 'other' };
    else if (change === 'app') m.props.appId = 'other-app';
    else m.unmount();
    await tick(3); hold.resolve({ kind: 'ok', value: { items: [choice('stale')], hasMore: false } }); await tick(5);
    expect(m.target.textContent).not.toContain('Task stale');
    if (change !== 'destroy') { filter(m.target, 'stale'); await tick(3); expect(m.target.textContent).not.toContain('Task stale'); }
  });
  it('rejects foreign rows, keeps the earlier view and does not infer counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'ok', value: { items: [choice('secret', 'foreign')], hasMore: false } }))));
    const m = await setup(); button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more Waits for. Try again.');
    filter(m.target, 'secret'); await tick(3); expect(m.target.textContent).not.toContain('Task secret');
    expect(m.target.textContent).not.toContain('total relations');
  });
});
