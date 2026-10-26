/**
 * portal#1316 — the Composition view's lifecycle: Refresh and Try again reload
 * through `invalidateAll` exactly once per click, the view tears down cleanly,
 * and a click after teardown reaches nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent } from '$lib/test/mountComponent';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import TasksComposition from './TasksComposition.svelte';

const ok = { kind: 'ok' as const, value: { appId: 'app-1', asOf: '2026-10-26T00:00:00Z', lanes: [] } };
const buttonNamed = (root: HTMLElement, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

afterEach(() => {
  resetNavigationCalls();
  document.body.innerHTML = '';
});

describe('TasksComposition (mounted)', () => {
  it('Refresh reloads once per click', async () => {
    const { target, unmount } = mountComponent(TasksComposition, { composition: ok, basePath: '/app/apps/app-1', impersonating: null });
    const refresh = buttonNamed(target, /^Refresh$/);
    expect(refresh).toBeTruthy();
    refresh!.click();
    flushSync();
    await Promise.resolve();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    unmount();
  });

  it('Try again after a failed read reloads, and the failed state is not the empty state', () => {
    const { target, unmount } = mountComponent(TasksComposition, { composition: { kind: 'failed' as const }, basePath: '/app/apps/app-1', impersonating: null });
    expect(target.textContent).toContain('Couldn’t load the composition.');
    expect(target.textContent).not.toContain('No workers on this App’s roster.');
    buttonNamed(target, /Try again/)!.click();
    flushSync();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    unmount();
  });

  it('unmount empties the target, and a stale click afterwards reloads nothing', () => {
    const { target, unmount } = mountComponent(TasksComposition, { composition: ok, basePath: '/app/apps/app-1', impersonating: null });
    const refresh = buttonNamed(target, /^Refresh$/)!;
    unmount();
    expect(target.querySelector('button')).toBeNull();
    refresh.click();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
});

const party = (id: string, name: string) => ({ id, kind: 'WORKER' as const, name, urn: `hrn:worker:acme.com:team:${id}` });
const withLane = (over: Record<string, unknown>) => ({
  kind: 'ok' as const,
  value: {
    appId: 'app-1',
    asOf: '2026-10-26T00:00:00Z',
    lanes: [{ coordinator: null, coordinatorRetired: false, workers: [], countsByRole: [], countsByRoleFamily: [], ...over }],
  },
});

describe('TasksComposition (mounted) — review findings at 445cc9e1', () => {
  it('headcount pills whose role/family concatenate the same keep one pill each (no duplicate key)', () => {
    const composition = withLane({
      coordinator: party('c', 'Cleo'),
      countsByRoleFamily: [
        { role: 'a/b', family: 'c', count: 1 },
        { role: 'a', family: 'b/c', count: 2 },
        { role: null, family: 'x', count: 3 },
        { role: '', family: 'x', count: 4 },
      ],
    });
    const { target, unmount } = mountComponent(TasksComposition, { composition, basePath: '/app/apps/app-1', impersonating: null });
    expect(target.querySelectorAll('[data-count-role-family]')).toHaveLength(4);
    unmount();
  });

  it('a retired coordinator is found by searching "retired", in both tables', () => {
    const composition = withLane({
      coordinator: party('c', 'Cleo'),
      coordinatorRetired: true,
      workers: [{ worker: party('w1', 'Avery'), role: 'engineer', family: 'claude', bound: true, liveSession: false, state: 'AVAILABLE' }],
      countsByRole: [{ role: 'engineer', count: 1 }],
      countsByRoleFamily: [{ role: 'engineer', family: 'claude', count: 1 }],
    });
    const { target, unmount } = mountComponent(TasksComposition, { composition, basePath: '/app/apps/app-1', impersonating: null });
    for (const label of [/Search the lanes/, /Search the workers/]) {
      const input = [...target.querySelectorAll('input')].find((i) => label.test(i.getAttribute('aria-label') ?? ''))!;
      input.value = 'retired';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    }
    expect(target.querySelectorAll('[data-lane]')).toHaveLength(1);
    expect(target.querySelectorAll('[data-worker]')).toHaveLength(1);
    unmount();
  });

  it('a failed reload does not leave an unhandled rejection, and Refresh comes back', async () => {
    const { target, unmount } = mountComponent(TasksComposition, { composition: ok, basePath: '/app/apps/app-1', impersonating: null });
    navigationHooks.onInvalidateAll = () => { throw new Error('offline'); };
    const refresh = buttonNamed(target, /^Refresh$/)!;
    const caught = await captureUnhandledRejections(async () => {
      refresh.click();
      flushSync();
      await Promise.resolve();
    });
    expect(caught).toEqual([]);
    expect(refresh.disabled).toBe(false);
    unmount();
  });
});
