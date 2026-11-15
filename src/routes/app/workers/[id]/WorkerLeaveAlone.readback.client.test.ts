/** portal#2195 review (F2) — the leave-alone control after a committed write whose reload fails or hangs. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import WorkerLeaveAlone from './WorkerLeaveAlone.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  vi.useRealTimers();
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
const NOT_MARKED = { on: false, reason: null, by: null, at: null };
const ok = { type: 'success' as const, status: 200, data: {} };
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement | undefined;
async function markWorker() {
  const m = mountComponent(WorkerLeaveAlone as never, { marker: NOT_MARKED, canManage: true } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  const root = m.target;
  button(root, 'Leave alone…')!.click();
  flushSync();
  const deliver = await beginEnhanced(root.querySelector('form')!);
  return { root, deliver };
}

describe('worker leave-alone after a committed write whose reload fails or hangs (F2)', () => {
  it('says the page may be out of date and offers no further write when the reload rejects', async () => {
    const { root, deliver } = await markWorker();
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await expect(deliver(ok)).resolves.toBeUndefined();
    flushSync();
    expect(root.textContent).toContain('Saved');
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    expect(button(root, 'Leave alone…')?.disabled ?? true).toBe(true);
  });

  it('warns the same way when the reload never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { root, deliver } = await markWorker();
    const release = holdInvalidateAll();
    const done = deliver(ok);
    await tick(3);
    expect(button(root, 'Leave alone…')?.disabled ?? true).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    flushSync();
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    release();
    await done;
  });
});
