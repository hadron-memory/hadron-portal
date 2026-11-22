/**
 * portal#2464 (hadron-server#4777, hrn:node:hadronmemory.com:specs:cor:agt:060:16): the wake-roles setting.
 * A manager edits the whole list; a participant reads it; the roster's refusal leaves the setting absent;
 * the empty state is honest; "Saved." announces in a status region that was already mounted and empty.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import SaturationAlarmWakeRoles from './SaturationAlarmWakeRoles.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
function mountIt(props: Record<string, unknown>) {
  const m = mountComponent(SaturationAlarmWakeRoles as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}
const ok = (roles: string[]) => ({ kind: 'ok', roles });
const sentRoles = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input[name="roles"]')].map((i) => i.value);
async function addRole(root: HTMLElement, text: string) {
  const input = root.querySelector<HTMLInputElement>('#wake-role-input')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  flushSync();
  await tick();
}

describe('saturation alarm wake roles (portal#2464)', () => {
  it('a manager adds a role: trimmed and lower-cased, listed once, sent as the whole list', async () => {
    const root = mountIt({ read: ok(['triager']), canManage: true });
    await tick();
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(true);
    await addRole(root, '  Reviewer ');
    await addRole(root, 'reviewer');
    expect(sentRoles(root)).toEqual(['reviewer', 'triager']);
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(false);
  });

  it('removing the last role leaves an empty list that can be saved (the clear)', async () => {
    const root = mountIt({ read: ok(['triager']), canManage: true });
    await tick();
    root.querySelector<HTMLButtonElement>('button[aria-label="Remove triager"]')!.click();
    flushSync();
    expect(sentRoles(root)).toEqual([]);
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(false);
  });

  it('empty is said honestly and offers no example role name', async () => {
    const root = mountIt({ read: ok([]), canManage: true });
    await tick();
    expect(root.textContent).toMatch(/Nobody is woken/);
    expect(root.textContent).toMatch(/still recorded and readable/);
    expect(root.querySelector<HTMLInputElement>('#wake-role-input')!.placeholder).toBe('');
  });

  it('a participant who does not manage reads the list and gets no controls', async () => {
    const root = mountIt({ read: ok(['triager']), canManage: false });
    await tick();
    expect(root.textContent).toContain('triager');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(root.textContent).toMatch(/Only whoever manages this App/);
  });

  it('the roster refusal leaves the setting absent, not an empty list or an error', async () => {
    const root = mountIt({ read: { kind: 'hidden' }, canManage: false });
    await tick();
    expect(root.querySelector('section')).toBeNull();
  });

  it('a failed read says so and never shows an empty list', async () => {
    const root = mountIt({ read: { kind: 'failed' }, canManage: true });
    await tick();
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/couldn.t be loaded/);
    expect(root.textContent).not.toMatch(/Nobody is woken/);
    expect(root.querySelector('form')).toBeNull();
  });

  it('does not promise a retroactive wake', async () => {
    const root = mountIt({ read: ok([]), canManage: true });
    await tick();
    expect(root.textContent).toMatch(/applies to alarms raised afterwards/);
  });

  it('shows the server sentence on a refusal and keeps the draft', async () => {
    const root = mountIt({ read: ok([]), canManage: true });
    await tick();
    await addRole(root, 'bad role');
    await submitEnhancedWithResult(root.querySelector('form')!, { type: 'failure', status: 400, data: { wakeRolesError: 'At most 32 names.' } });
    await tick(3);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('At most 32 names.');
    expect(sentRoles(root)).toEqual(['bad role']);
  });

  it('"Saved." lands in the status region that was already mounted and empty', async () => {
    const root = mountIt({ read: ok([]), canManage: true });
    await tick();
    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    await addRole(root, 'triager');
    await submitEnhancedWithResult(root.querySelector('form')!, { type: 'success', status: 200, data: {} });
    await tick(3);
    const region = announcedStatusRegion(root);
    expect(region?.textContent).toContain('Saved.');
    expect(idle).toContain(region);
  });
});
