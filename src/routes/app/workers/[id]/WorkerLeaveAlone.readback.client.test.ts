/** portal#2195 review (F2) — the leave-alone control after a committed write whose reload fails or hangs. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
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

describe('the marker is not shown as current after a committed write whose reload failed (blind P2)', () => {
  const MARKED = { on: true, reason: 'host migration', by: '@ada', at: '2026-11-15T12:00:00Z' };

  it('does not keep saying "Not marked" after marking', async () => {
    const { root, deliver } = await markWorker();
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(root.textContent).not.toContain('Not marked');
    expect(root.textContent).toMatch(/current marker is unknown|marker.*unknown/i);
  });

  it('does not keep saying the sweep leaves the worker alone after clearing', async () => {
    const m = mountComponent(WorkerLeaveAlone as never, { marker: MARKED, canManage: true } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const root = m.target;
    expect(root.textContent).toContain('leaves this worker alone');
    const deliver = await beginEnhanced(root.querySelector('form')!);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(root.textContent).not.toContain('leaves this worker alone');
    expect(root.textContent).not.toContain('host migration');
    expect(root.textContent).toMatch(/marker.*unknown/i);
  });
});

describe('the unconfirmed marker outlives a remount (Diego delta P2, matching branch)', () => {
  it('still says the marker is unknown after the control is remounted on unchanged loader data, until the loader shows what was written', async () => {
    const mountOwned = (marker: Record<string, unknown>) => {
      const props = reactiveProps({ marker, canManage: true, ownerId: 'worker-a' });
      const m = mountComponent(WorkerLeaveAlone as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      return { root: m.target, props };
    };
    const first = mountOwned(NOT_MARKED);
    button(first.root, 'Leave alone…')!.click();
    flushSync();
    // The write carries its reason: only a loader showing it too confirms the write (F2).
    first.root.querySelector<HTMLInputElement>('#leave-alone-reason')!.value = 'host migration';
    const deliver = await beginEnhanced(first.root.querySelector('form')!);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    mounted.pop()!.unmount();
    const second = mountOwned(NOT_MARKED);
    expect(second.root.textContent).not.toContain('Not marked');
    expect(second.root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    second.props.marker = { on: true, reason: 'host migration', by: '@ada', at: '2026-11-15T12:00:00Z' };
    flushSync();
    expect(second.root.querySelector('[role="alert"]')).toBeNull();
    expect(second.root.textContent).toContain('host migration');
  });
});

describe('a matching marker boolean is not confirmation of the written reason (local delta F2)', () => {
  const OLD = { on: true, reason: 'OLD OTHER REASON', by: '@bob', at: '2026-11-14T12:00:00Z' };

  async function markWithNewReason(props: { marker: typeof NOT_MARKED | typeof OLD; canManage: boolean }) {
    const m = mountComponent(WorkerLeaveAlone as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const root = m.target;
    button(root, 'Leave alone…')!.click();
    flushSync();
    const input = root.querySelector<HTMLInputElement>('#leave-alone-reason')!;
    input.value = 'OUR NEW REASON';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const deliver = await beginEnhanced(root.querySelector('form')!);
    return { root, deliver };
  }

  it('keeps the lock and the unknown-marker warning when the loader shows the same on-state with another reason', async () => {
    const props = reactiveProps({ marker: NOT_MARKED as typeof NOT_MARKED | typeof OLD, canManage: true });
    const { root, deliver } = await markWithNewReason(props);
    props.marker = OLD;
    flushSync();
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(root.textContent).not.toContain('OLD OTHER REASON');
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
  });

  it('lets go once the loader shows the written reason as well', async () => {
    const props = reactiveProps({ marker: NOT_MARKED as typeof NOT_MARKED | typeof OLD, canManage: true });
    const { root, deliver } = await markWithNewReason(props);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    props.marker = { ...OLD, reason: 'OUR NEW REASON' };
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('OUR NEW REASON');
  });
});

describe('recovery starts at submission, not at the response (blind delta F5)', () => {
  it('a remount before the response keeps the control locked', async () => {
    const { root, deliver } = await markWorker();
    mounted.pop()!.unmount();
    const again = mountComponent(WorkerLeaveAlone as never, { marker: NOT_MARKED, canManage: true } as never) as Mounted<Record<string, unknown>>;
    mounted.push(again);
    expect(button(again.target, 'Leave alone…')!.disabled).toBe(true);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(again.target.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
  });
});
