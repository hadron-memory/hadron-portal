/**
 * portal#2194 — the App page's sweep-mode control, mounted. A manager sees the
 * three modes with the saved one selected; choosing Apply asks first, saying it
 * starts and stops agent processes, and submits only from that confirmation; a
 * non-manager sees the mode with no controls; a refusal shows as it came back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AppSweepMode from './AppSweepMode.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
function mountIt(mode: 'OFF' | 'OBSERVE' | 'APPLY' | null, canManage: boolean) {
  const m = mountComponent(AppSweepMode as never, { mode, canManage } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}
const radio = (root: HTMLElement, v: string) => root.querySelector<HTMLInputElement>(`input[name="mode"][value="${v}"]`)!;
const label = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement | undefined;
const form = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/setSweepMode"]')!;

describe('App sweep-mode control (portal#2194)', () => {
  it('renders nothing when the server did not say', async () => {
    const root = mountIt(null, true);
    await tick();
    expect(root.querySelector('section')).toBeNull();
  });

  it('shows a non-manager the mode and no controls', async () => {
    const root = mountIt('OBSERVE', false);
    await tick();
    expect(root.textContent).toContain('Observe');
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
  });

  it('selects the saved mode for a manager and offers Save only for a change', async () => {
    const root = mountIt('OFF', true);
    await tick();
    expect(radio(root, 'OFF').checked).toBe(true);
    expect(label(root, 'Save')!.disabled).toBe(true);
    radio(root, 'OBSERVE').click();
    flushSync();
    expect(label(root, 'Save')!.disabled).toBe(false);
    expect(new FormData(form(root)).get('mode')).toBe('OBSERVE');
  });

  it('asks before Apply, saying it starts and stops agent processes, and submits only from the confirmation', async () => {
    const root = mountIt('OBSERVE', true);
    radio(root, 'APPLY').click();
    flushSync();
    let submitted = 0;
    form(root).addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    label(root, 'Save')!.click();
    flushSync();
    expect(submitted).toBe(0);
    expect(root.querySelector('[role="alert"]')!.textContent).toMatch(/starts and stops agent processes/);
    expect(label(root, 'Save')).toBeUndefined();
    label(root, 'Apply')!.click();
    expect(submitted).toBe(1);
    label(root, 'Cancel')!.click();
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('saves OBSERVE without a confirmation', async () => {
    const root = mountIt('OFF', true);
    radio(root, 'OBSERVE').click();
    flushSync();
    let submitted = 0;
    form(root).addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    label(root, 'Save')!.click();
    expect(submitted).toBe(1);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the server refusal as it came back', async () => {
    const root = mountIt('OFF', true);
    radio(root, 'OBSERVE').click();
    flushSync();
    await submitEnhancedWithResult(form(root), { type: 'failure', status: 403, data: { sweepModeError: 'Only an App manager may change this.' } });
    flushSync();
    expect(root.querySelector('[role="alert"]')!.textContent).toBe('Only an App manager may change this.');
  });
});
