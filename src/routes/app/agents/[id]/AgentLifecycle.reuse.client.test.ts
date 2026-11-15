/** portal#2195 review (F1, F2) — the lifecycle control reused for another Agent, and a failed or hung reload. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AgentLifecycle from './AgentLifecycle.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  vi.useRealTimers();
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
type L = 'LONG_LIVED' | 'SHORT_LIVED';
function mountIt(lifecycle: L, ownerId = 'agent-a') {
  const props = reactiveProps({ lifecycle, ownerId });
  const m = mountComponent(AgentLifecycle as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { root: m.target, props };
}
const radio = (root: HTMLElement, v: string) => root.querySelector<HTMLInputElement>(`input[name="lifecycle"][value="${v}"]`)!;
const save = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const form = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/updateLifecycle"]')!;
const ok = { type: 'success' as const, status: 200, data: {} };

describe('lifecycle control reused for another Agent (F1)', () => {
  it('drops a draft when the Agent changes, to the same or a different saved value', async () => {
    const { root, props } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    props.ownerId = 'agent-b';
    flushSync();
    expect(radio(root, 'LONG_LIVED').checked).toBe(true);
    expect(save(root).disabled).toBe(true);
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    props.lifecycle = 'SHORT_LIVED';
    props.ownerId = 'agent-c';
    flushSync();
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(save(root).disabled).toBe(true);
  });

  it("does not show the old Agent's refusal or success on the new one", async () => {
    const { root, props } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const refuse = await beginEnhanced(form(root));
    props.ownerId = 'agent-b';
    flushSync();
    await refuse({ type: 'failure', status: 403, data: { lifecycleError: 'OLD AGENT REFUSAL' } });
    flushSync();
    expect(root.textContent).not.toContain('OLD AGENT REFUSAL');
    expect(save(root).textContent!.trim()).toBe('Save');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const accept = await beginEnhanced(form(root));
    props.ownerId = 'agent-c';
    flushSync();
    await accept(ok);
    flushSync();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
});

describe('lifecycle control after a committed write whose reload fails or hangs (F2)', () => {
  it('keeps the saved value and warns when the reload rejects', async () => {
    const { root } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await expect(deliver(ok)).resolves.toBeUndefined();
    flushSync();
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(root.textContent).toContain('Saved');
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    expect(save(root).disabled).toBe(true);
  });

  it('warns the same way when the reload never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { root } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    const release = holdInvalidateAll();
    const done = deliver(ok);
    await tick(3);
    expect(save(root).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    flushSync();
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    release();
    await done;
  });
});
