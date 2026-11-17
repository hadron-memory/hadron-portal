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

describe('lifecycle choices are fixed while a write is in flight or unconfirmed (blind P2)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;

  it('disables the choices while saving and after a failed reload, keeping the saved value selected', async () => {
    const { root } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    flushSync();
    expect(fieldset(root).disabled).toBe(true);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(fieldset(root).disabled).toBe(true);
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Saved');
  });

  it('offers the choices again once the reload lands', async () => {
    const { root, props } = mountIt('LONG_LIVED');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver(ok);
    props.lifecycle = 'SHORT_LIVED';
    flushSync();
    expect(fieldset(root).disabled).toBe(false);
  });
});

describe('recovery outlives the control visit (Diego delta P2)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;

  it('A -> B -> A before the response: the committed value is shown on A, locked and warned', async () => {
    const { root, props } = mountIt('LONG_LIVED', 'agent-a');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    props.ownerId = 'agent-b';
    flushSync();
    props.ownerId = 'agent-a';
    flushSync();
    await deliver(ok);
    flushSync();
    expect(radio(root, 'SHORT_LIVED').checked).toBe(true);
    expect(fieldset(root).disabled).toBe(true);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
  });

  it('keeps the warning and the lock across a remount on unchanged loader data, and lets go when the loader catches up', async () => {
    const first = mountIt('LONG_LIVED', 'agent-a');
    radio(first.root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    mounted.pop()!.unmount();
    const second = mountIt('LONG_LIVED', 'agent-a');
    expect(radio(second.root, 'SHORT_LIVED').checked).toBe(true);
    expect(fieldset(second.root).disabled).toBe(true);
    expect(second.root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    second.props.lifecycle = 'SHORT_LIVED';
    flushSync();
    expect(second.root.querySelector('[role="alert"]')).toBeNull();
    expect(fieldset(second.root).disabled).toBe(false);
  });
});

describe('recovery starts at submission, not at the response (blind delta F5)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;

  it('a remount before the response keeps the lock, so a second write cannot overlap the first', async () => {
    const first = mountIt('LONG_LIVED', 'agent-a');
    radio(first.root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    mounted.pop()!.unmount();
    const second = mountIt('LONG_LIVED', 'agent-a');
    expect(fieldset(second.root).disabled).toBe(true);
    expect(radio(second.root, 'SHORT_LIVED').checked).toBe(true);
    await deliver(ok);
    second.props.lifecycle = 'SHORT_LIVED';
    flushSync();
    expect(fieldset(second.root).disabled).toBe(false);
  });

  it('a failed write releases the lock', async () => {
    const { root } = mountIt('LONG_LIVED', 'agent-a');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver({ type: 'failure', status: 400, data: { lifecycleError: 'no' } });
    flushSync();
    expect(fieldset(root).disabled).toBe(false);
  });
});

describe('an uncertain outcome keeps the lock and says so (blind P2 on #2198)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;
  const uncertain = { type: 'failure' as const, status: 502, data: { lifecycleError: 'Couldn’t confirm the save; checking…', uncertain: true } };

  it.each([
    ['an uncertain failure result', uncertain],
    ['a transport error result', { type: 'error' as const, status: 500, error: new Error('fetch failed') }],
  ])('%s: stays locked, never says Not saved, and lets go when the loader shows the choice', async (_n, result) => {
    const { root, props } = mountIt('LONG_LIVED', 'agent-a');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(result as never);
    flushSync();
    expect(fieldset(root).disabled).toBe(true);
    expect(root.textContent).not.toMatch(/not saved/i);
    expect(root.textContent).toMatch(/couldn.t confirm/i);
    props.lifecycle = 'SHORT_LIVED';
    flushSync();
    expect(fieldset(root).disabled).toBe(false);
  });

  it('a refusal that did not commit releases the lock and says Not saved', async () => {
    const { root } = mountIt('LONG_LIVED', 'agent-a');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver({ type: 'failure', status: 403, data: { lifecycleError: 'Only the owner can change this.' } });
    flushSync();
    expect(fieldset(root).disabled).toBe(false);
    expect(root.textContent).toContain('Only the owner');
  });
});

describe('the checking status ends when the readback confirms (Diego P3 on #2198)', () => {
  it('clears the "checking…" status together with the lock once the loader shows the choice', async () => {
    const { root, props } = mountIt('LONG_LIVED', 'agent-a');
    radio(root, 'SHORT_LIVED').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver({ type: 'error' as const, status: 500, error: new Error('fetch failed') } as never);
    props.lifecycle = 'SHORT_LIVED';
    flushSync();
    await tick(3);
    flushSync();
    expect(root.querySelector('fieldset')!.disabled).toBe(false);
    expect(root.textContent).not.toMatch(/checking/i);
  });
});

