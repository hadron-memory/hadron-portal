/**
 * portal#1316 — the Composition view's lifecycle: Refresh and Try again reload
 * through `invalidateAll` exactly once per click, the view tears down cleanly,
 * and a click after teardown reaches nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
