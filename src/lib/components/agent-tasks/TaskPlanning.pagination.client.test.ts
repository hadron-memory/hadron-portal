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
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function deferred() { let resolve!: (value: Response) => void; return { promise: new Promise<Response>((r) => resolve = r), resolve: (body: unknown) => resolve(reply(body)) }; }

describe('relation forward pages', () => {
  it('reads beyond 200 independently in both directions and removes a later blocker then refreshes', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const direction = new URL(url, 'http://localhost').searchParams.get('direction');
      return reply({ kind: 'ok', value: { items: [choice(direction === 'blockedBy' ? 'later' : 'held')], hasMore: false } });
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
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('private fault')).mockResolvedValue(reply({ kind: 'ok', value: { items: [choice('later')], hasMore: false } }));
    vi.stubGlobal('fetch', fetcher); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more Waits for. Try again.');
    expect(m.target.textContent).toContain('Task 0'); expect(m.target.textContent).not.toContain('private fault');
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
    expect(m.target.textContent).not.toContain('Couldn’t load more Waits for. Try again.');
  });
  it.each(['task', 'app'])('discards a pending page after %s changes', async (change) => {
    const hold = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise)); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick();
    if (change === 'task') m.props.task = { ...m.props.task, id: 'other' };
    else if (change === 'app') m.props.appId = 'other-app';
    await tick(3); hold.resolve({ kind: 'ok', value: { items: [choice('stale')], hasMore: false } }); await tick(5);
    expect(m.target.textContent).not.toContain('Task stale');
    expect(m.target.textContent).not.toContain('Task 0');
  });
  it('rejects foreign rows, keeps the earlier view and does not infer counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: [choice('secret', 'foreign')], hasMore: false } })));
    const m = await setup(); button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more Waits for. Try again.');
    filter(m.target, 'secret'); await tick(3); expect(m.target.textContent).not.toContain('Task secret');
    expect(m.target.textContent).not.toContain('total relations');
  });
  it('uses hasMore even on a short page and advances by served rows only', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ kind: 'ok', value: { items: [choice('later')], hasMore: true } })).mockResolvedValueOnce(reply({ kind: 'ok', value: { items: [], hasMore: false } }));
    vi.stubGlobal('fetch', fetcher); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick(5);
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      '/app/apps/app/tasks/task/relations?direction=blockedBy&offset=200',
      '/app/apps/app/tasks/task/relations?direction=blockedBy&offset=201',
    ]);
    expect(Array.from(m.target.querySelectorAll('button')).some((b) => b.textContent === 'Load more Waits for')).toBe(false);
  });
  it('keeps a new read locked when an old A → B → A reply settles', async () => {
    const old = deferred(); const next = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    vi.stubGlobal('fetch', fetcher); const m = await setup(); const original = m.props.task;
    button(m.target, 'Load more Waits for').click(); await tick();
    m.props.task = { ...original, id: 'B' }; m.props.dependencies = first(); await tick(3);
    m.props.task = original; m.props.dependencies = first(); await tick(3);
    button(m.target, 'Load more Waits for').click(); await tick();
    old.resolve({ kind: 'ok', value: { items: [choice('old')], hasMore: false } }); await tick(5);
    const more = button(m.target, 'Load more Waits for');
    expect(more.disabled).toBe(false); expect(more.getAttribute('aria-disabled')).toBe('true');
    more.click(); expect(fetcher).toHaveBeenCalledTimes(2);
    next.resolve({ kind: 'ok', value: { items: [choice('new')], hasMore: false } }); await tick(5);
    filter(m.target, 'Task old'); await tick(3); expect(m.target.textContent).not.toContain('Task old');
    filter(m.target, 'Task new'); await tick(3); expect(m.target.textContent).toContain('Task new');
  });
  it('a committed removal refresh discards a relation read from the old snapshot', async () => {
    const old = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(old.promise)); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick();
    navigationHooks.onInvalidateAll = () => { m.props.dependencies = { kind: 'ok', value: { blockedBy: { items: [choice('fresh')], hasMore: false }, blocks: { items: [], hasMore: false } } }; };
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form[action="?/removeBlocker"]')!, { type: 'success', status: 200, data: {} }); await tick(3);
    old.resolve({ kind: 'ok', value: { items: [choice('stale')], hasMore: false } }); await tick(5);
    expect(m.target.textContent).toContain('Task fresh');
    filter(m.target, 'stale'); await tick(3); expect(m.target.textContent).not.toContain('Task stale');
  });

  it('rejects a repeated page and offers reload instead of repeating the shifted offset', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: [choice('0')], hasMore: true } }));
    vi.stubGlobal('fetch', fetcher); const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick(5);
    expect(m.target.textContent).toContain('Loaded rows are unchanged.');
    expect(m.target.querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['STARTED', 'FINISHED', 'impersonation'])('later pages do not grant Remove under %s', async (state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: [choice('later')], hasMore: false } })));
    const m = await setup();
    if (state === 'impersonation') m.props.canWrite = false;
    else m.props.task = { ...m.props.task, status: state };
    await tick(3); button(m.target, 'Load more Waits for').click(); await tick(5);
    filter(m.target, 'Task later'); await tick(3);
    expect(m.target.textContent).toContain('Task later');
    expect(m.target.querySelector('form[action="?/removeBlocker"]')).toBeNull();
  });

  it('does not consume a delayed page after destruction (onDestroy-generation mutant fails)', async () => {
    const hold = deferred(); const consumed = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = await setup();
    button(m.target, 'Load more Waits for').click(); await tick();
    m.unmount();
    hold.resolve({ kind: 'ok', get value() { consumed(); return { items: [choice('late')], hasMore: false }; } });
    await tick(5);
    expect(consumed).not.toHaveBeenCalled();
  });

});
