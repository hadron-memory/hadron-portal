import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import SelectHost from './SelectHost.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
function mountHost(props: Record<string, unknown>) {
  const m = mountComponent(SelectHost as never, { onretry: () => {}, ...props } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}
const hosts = [
  { hostId: 'h-a', label: 'Alpha', live: true },
  { hostId: 'h-b', label: 'Beta', live: false },
];

describe('SelectHost (portal#2311)', () => {
  it('lists each host as a radio with label, id chip and liveness in words', () => {
    const el = mountHost({ state: { kind: 'ok', hosts } });
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="hostId"]')];
    expect(radios.map((r) => r.value)).toEqual(['h-a', 'h-b']);
    expect(el.textContent).toContain('Alpha');
    expect(el.querySelector('code')?.textContent).toBe('h-a');
    expect(el.textContent).toContain('Live');
    expect(el.textContent).toContain('Offline');
    expect(el.querySelector('input[type="text"]')).toBeNull();
  });

  it('refused: says so, offers no host and no free-text field', () => {
    const el = mountHost({ state: { kind: 'refused' } });
    expect(el.textContent).toContain("You can't see this App's hosts");
    expect(el.querySelector('input')).toBeNull();
  });

  it('failed: shows an error with Retry that calls onretry', () => {
    const onretry = vi.fn();
    const el = mountHost({ state: { kind: 'failed' }, onretry });
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    el.querySelector<HTMLButtonElement>('button')!.click();
    expect(onretry).toHaveBeenCalledTimes(1);
    expect(el.querySelector('input')).toBeNull();
  });

  it('empty: says no hosts are registered, only for an answered read', () => {
    const el = mountHost({ state: { kind: 'ok', hosts: [] } });
    expect(el.textContent).toContain('No hosts are registered for this App');
    expect(el.querySelector('input')).toBeNull();
  });

  it('loading is neither the empty nor the refused message', () => {
    const el = mountHost({ state: { kind: 'loading' } });
    expect(el.textContent).toContain('Loading hosts');
    expect(el.textContent).not.toContain('No hosts');
    expect(el.textContent).not.toContain("can't see");
  });

  it('a held host missing from the list reads "Unknown host <id>", not selectable', () => {
    const el = mountHost({ state: { kind: 'ok', hosts }, held: 'h-gone' });
    const unknown = el.querySelector('[data-testid="select-host-unknown"]')!;
    expect(unknown.textContent).toContain('Unknown host');
    expect(unknown.textContent).toContain('h-gone');
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value)).not.toContain('h-gone');
  });

  it('a held host that IS listed shows no unknown row', () => {
    const el = mountHost({ state: { kind: 'ok', hosts }, held: 'h-a' });
    expect(el.querySelector('[data-testid="select-host-unknown"]')).toBeNull();
  });
});
