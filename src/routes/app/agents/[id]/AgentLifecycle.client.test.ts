/**
 * portal#2194 — the Agent page's lifecycle control, mounted. What only a mount
 * shows: the saved value is what is selected, Save is offered only for a change,
 * the form carries the choice, a refusal is shown beside the form as it came
 * back, and a reused component follows the loader again after a save.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { beginEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AgentLifecycle from './AgentLifecycle.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
function mountIt(lifecycle: 'LONG_LIVED' | 'SHORT_LIVED') {
  const props = reactiveProps({ lifecycle });
  const m = mountComponent(AgentLifecycle as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { root: m.target, props };
}
const radio = (root: HTMLElement, v: string) => root.querySelector<HTMLInputElement>(`input[name="lifecycle"][value="${v}"]`)!;
const save = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const form = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/updateLifecycle"]')!;

describe('Agent lifecycle control (portal#2194)', () => {
  it('selects the saved value and offers Save only for a change', async () => {
    const { root } = mountIt('LONG_LIVED');
    await tick();
    expect(radio(root, 'LONG_LIVED').checked).toBe(true);
    expect(save(root).disabled).toBe(true);
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    expect(save(root).disabled).toBe(false);
    expect(new FormData(form(root)).get('lifecycle')).toBe('SHORT_LIVED');
  });

  it('shows the server refusal beside the form and keeps the choice', async () => {
    const { root } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    await submitEnhancedWithResult(form(root), { type: 'failure', status: 403, data: { lifecycleError: 'Only the agent’s owner can change this.' } });
    flushSync();
    expect(root.querySelector('[role="alert"]')!.textContent).toBe('Only the agent’s owner can change this.');
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
  });

  // portal#2375: both results land in a status region that was mounted, empty, before the write.
  it('announces "Saved." in the region that was already mounted, empty', async () => {
    const { root } = mountIt('LONG_LIVED');
    await tick();
    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(root)).toBeNull();
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    await submitEnhancedWithResult(form(root), { type: 'success', status: 200, data: { lifecycleSaved: 'SHORT_LIVED' } });
    flushSync();
    const announced = announcedStatusRegion(root);
    expect(announced?.textContent).toBe('Saved.');
    expect(idle).toContain(announced);
  });

  it('announces the "Couldn’t confirm the save" note in the region that was already mounted, empty', async () => {
    const { root } = mountIt('LONG_LIVED');
    await tick();
    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(root)).toBeNull();
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    // The note shows while the read-back is pending, so hold the reload open.
    const deliver = await beginEnhanced(form(root));
    const release = holdInvalidateAll();
    const done = deliver({ type: 'failure', status: 502, data: { lifecycleError: 'x', uncertain: true } });
    await tick(3);
    flushSync();
    const announced = announcedStatusRegion(root);
    expect(announced?.textContent).toMatch(/couldn.t confirm the save/i);
    expect(idle).toContain(announced);
    release();
    await done;
  });

  it('on success says so, reloads, and follows the new loader value', async () => {
    const { root, props } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    await submitEnhancedWithResult(form(root), { type: 'success', status: 200, data: { lifecycleSaved: 'SHORT_LIVED' } });
    flushSync();
    expect(root.querySelector('[role="status"]')!.textContent).toBe('Saved.');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    props.lifecycle = 'SHORT_LIVED';
    flushSync();
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(save(root).disabled).toBe(true);
  });
});
