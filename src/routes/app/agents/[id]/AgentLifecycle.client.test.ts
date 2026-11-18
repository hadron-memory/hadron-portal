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
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
