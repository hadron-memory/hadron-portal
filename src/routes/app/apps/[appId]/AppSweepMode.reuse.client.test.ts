/**
 * portal#2195 review (F1, F2) — the sweep-mode control when the page REUSES it for another
 * App, and when the reload after a committed write fails or hangs. Red before the owner
 * identity and the read-back guard exist.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AppSweepMode from './AppSweepMode.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  vi.useRealTimers();
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
type Mode = 'OFF' | 'OBSERVE' | 'APPLY';
function mountIt(mode: Mode, ownerId = 'app-a') {
  const props = reactiveProps({ mode, canManage: true, ownerId });
  const m = mountComponent(AppSweepMode as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { root: m.target, props };
}
const radio = (root: HTMLElement, v: string) => root.querySelector<HTMLInputElement>(`input[name="mode"][value="${v}"]`)!;
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement | undefined;
const form = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/setSweepMode"]')!;
const ok = { type: 'success' as const, status: 200, data: {} };

describe('sweep-mode control reused for another App (F1)', () => {
  it('drops a draft and an open Apply confirmation when the App changes to the same saved value', async () => {
    const { root, props } = mountIt('OBSERVE', 'app-a');
    radio(root, 'APPLY').click();
    flushSync();
    button(root, 'Save')!.click();
    flushSync();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    props.ownerId = 'app-b';
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(radio(root, 'OBSERVE').checked).toBe(true);
    expect(radio(root, 'APPLY').checked).toBe(false);
  });

  it('drops the draft when the App changes to a different saved value', async () => {
    const { root, props } = mountIt('OBSERVE', 'app-a');
    radio(root, 'APPLY').click();
    flushSync();
    button(root, 'Save')!.click();
    flushSync();
    props.mode = 'OFF';
    props.ownerId = 'app-b';
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(radio(root, 'OFF').checked).toBe(true);
    expect(button(root, 'Save')!.disabled).toBe(true);
  });

  it("does not show the old App's refusal on the new App, nor leave it saving", async () => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    props.mode = 'APPLY';
    props.ownerId = 'app-b';
    flushSync();
    await deliver({ type: 'failure', status: 403, data: { sweepModeError: 'OLD APP REFUSAL' } });
    flushSync();
    expect(root.textContent).not.toContain('OLD APP REFUSAL');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(button(root, 'Save')!.textContent!.trim()).toBe('Save');
  });

  it("does not announce the old App's success on the new App, nor reload for it", async () => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    props.ownerId = 'app-b';
    flushSync();
    await deliver(ok);
    flushSync();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
});

describe('sweep-mode control after a committed write whose reload fails or hangs (F2)', () => {
  async function saveApply(root: HTMLElement) {
    radio(root, 'APPLY').click();
    flushSync();
    button(root, 'Save')!.click();
    flushSync();
    return await beginEnhanced(form(root));
  }

  it('keeps the saved mode selected and says the page may be out of date when the reload rejects', async () => {
    const { root } = mountIt('OFF');
    const deliver = await saveApply(root);
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await expect(deliver(ok)).resolves.toBeUndefined();
    flushSync();
    expect(radio(root, 'APPLY').checked).toBe(true);
    expect(radio(root, 'OFF').checked).toBe(false);
    expect(root.textContent).toContain('Saved');
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    expect(button(root, 'Save')!.disabled).toBe(true);
  });

  it('warns the same way when the reload never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { root } = mountIt('OFF');
    const deliver = await saveApply(root);
    const release = holdInvalidateAll();
    const done = deliver(ok);
    await tick(3);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(button(root, 'Save')!.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    flushSync();
    expect(radio(root, 'APPLY').checked).toBe(true);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    release();
    await done;
  });

  it('clears the draft and the lock once the reload lands', async () => {
    const { root, props } = mountIt('OFF');
    const deliver = await saveApply(root);
    await deliver(ok);
    props.mode = 'APPLY';
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(radio(root, 'APPLY').checked).toBe(true);
    radio(root, 'OBSERVE').click();
    flushSync();
    expect(button(root, 'Save')!.disabled).toBe(false);
  });
});

describe('sweep-mode choices are fixed while a write is in flight or unconfirmed (blind P2)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;

  it('disables the choices while saving, so a later pick cannot sit beside the saved one', async () => {
    const { root } = mountIt('OFF');
    radio(root, 'OBSERVE').click();
    flushSync();
    await beginEnhanced(form(root));
    flushSync();
    expect(fieldset(root).disabled).toBe(true);
  });

  it('keeps them disabled, and the saved mode selected, when the reload then fails', async () => {
    const { root } = mountIt('OFF');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(ok);
    flushSync();
    expect(fieldset(root).disabled).toBe(true);
    expect(radio(root, 'OBSERVE').checked).toBe(true);
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Saved');
  });

  it('offers the choices again once the reload lands', async () => {
    const { root, props } = mountIt('OFF');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver(ok);
    props.mode = 'OBSERVE';
    flushSync();
    expect(fieldset(root).disabled).toBe(false);
  });
});

describe('recovery outlives the control visit (Diego delta P2)', () => {
  const fieldset = (root: HTMLElement) => root.querySelector('fieldset')!;
  const failReload = () => { navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); }; };

  it('A -> B -> A before the APPLY response: the committed write is shown on A, locked and warned', async () => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'APPLY').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    props.ownerId = 'app-b';
    flushSync();
    props.ownerId = 'app-a';
    flushSync();
    await deliver(ok);
    flushSync();
    expect(radio(root, 'APPLY').checked).toBe(true);
    expect(fieldset(root).disabled).toBe(true);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
  });

  it('the same response while B is shown is not published on B, and waits for A', async () => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'APPLY').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    props.ownerId = 'app-b';
    flushSync();
    await deliver(ok);
    flushSync();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(fieldset(root).disabled).toBe(false);
    props.ownerId = 'app-a';
    flushSync();
    expect(radio(root, 'APPLY').checked).toBe(true);
    expect(fieldset(root).disabled).toBe(true);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
  });

  it('keeps the warning and the lock when the Settings tab is remounted on unchanged loader data', async () => {
    const first = mountIt('OFF', 'app-a');
    radio(first.root, 'APPLY').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    failReload();
    await deliver(ok);
    flushSync();
    expect(first.root.querySelector('[role="alert"]')).not.toBeNull();
    mounted.pop()!.unmount();
    const second = mountIt('OFF', 'app-a');
    expect(radio(second.root, 'APPLY').checked).toBe(true);
    expect(fieldset(second.root).disabled).toBe(true);
    expect(second.root.querySelector('[role="alert"]')!.textContent).toMatch(/reload/i);
    expect(button(second.root, 'Save')!.disabled).toBe(true);
  });

  it('lets go once the loader shows the committed value', async () => {
    const first = mountIt('OFF', 'app-a');
    radio(first.root, 'APPLY').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    failReload();
    await deliver(ok);
    flushSync();
    first.props.mode = 'APPLY';
    flushSync();
    expect(first.root.querySelector('[role="alert"]')).toBeNull();
    expect(fieldset(first.root).disabled).toBe(false);
    mounted.pop()!.unmount();
    const second = mountIt('APPLY', 'app-a');
    expect(second.root.querySelector('[role="alert"]')).toBeNull();
    expect(fieldset(second.root).disabled).toBe(false);
  });

  it('keeps one App\'s recovery away from another', async () => {
    const first = mountIt('OFF', 'app-a');
    radio(first.root, 'APPLY').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    failReload();
    await deliver(ok);
    flushSync();
    first.props.ownerId = 'app-b';
    flushSync();
    expect(first.root.querySelector('[role="alert"]')).toBeNull();
    expect(radio(first.root, 'OFF').checked).toBe(true);
  });
});

describe('recovery starts at submission, not at the response (blind delta F5)', () => {
  it('a remount before the response keeps the choices locked until the loader shows the write', async () => {
    const first = mountIt('OFF', 'app-a');
    radio(first.root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(first.root));
    mounted.pop()!.unmount();
    const second = mountIt('OFF', 'app-a');
    expect(second.root.querySelector('fieldset')!.disabled).toBe(true);
    expect(radio(second.root, 'OBSERVE').checked).toBe(true);
    await deliver(ok);
    second.props.mode = 'OBSERVE';
    flushSync();
    expect(second.root.querySelector('fieldset')!.disabled).toBe(false);
  });
});

describe('an uncertain outcome keeps the lock and says so (blind P2 on #2198)', () => {
  it.each([
    ['an uncertain failure result', { type: 'failure' as const, status: 502, data: { sweepModeError: 'Couldn’t confirm the save; checking…', uncertain: true } }],
    ['a transport error result', { type: 'error' as const, status: 500, error: new Error('fetch failed') }],
  ])('%s: stays locked, never says Not saved, and lets go when the loader shows the mode', async (_n, result) => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    navigationHooks.onInvalidateAll = () => { throw new Error('reload failed'); };
    await deliver(result as never);
    flushSync();
    expect(root.querySelector('fieldset')!.disabled).toBe(true);
    expect(root.textContent).not.toMatch(/not saved/i);
    expect(root.textContent).toMatch(/couldn.t confirm/i);
    props.mode = 'OBSERVE';
    flushSync();
    expect(root.querySelector('fieldset')!.disabled).toBe(false);
  });

  it('a refusal that did not commit releases the lock', async () => {
    const { root } = mountIt('OFF', 'app-a');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver({ type: 'failure', status: 403, data: { sweepModeError: 'Not allowed.' } });
    flushSync();
    expect(root.querySelector('fieldset')!.disabled).toBe(false);
  });
});

describe('the checking status ends when the readback confirms (Diego P3 on #2198)', () => {
  it('clears the "checking…" status together with the lock once the loader shows the mode', async () => {
    const { root, props } = mountIt('OFF', 'app-a');
    radio(root, 'OBSERVE').click();
    flushSync();
    const deliver = await beginEnhanced(form(root));
    await deliver({ type: 'error' as const, status: 500, error: new Error('fetch failed') } as never);
    props.mode = 'OBSERVE';
    flushSync();
    await tick(3);
    flushSync();
    expect(root.querySelector('fieldset')!.disabled).toBe(false);
    expect(root.textContent).not.toMatch(/checking/i);
  });
});

