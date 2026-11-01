/**
 * portal#1584 — SelectOrg's Escape layering, mounted (CLIENT lane). Same
 * contract as the other movers: opened inside a host dialog whose own
 * window-bubble Escape listener registered FIRST, one keypress closes ONE
 * layer — the picker — and the host's listener never fires; and a focus that
 * never entered the picker is still closed by the window fallback, without
 * leaking the keypress to the host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
import SelectOrg from './SelectOrg.svelte';

const orgs = [
  { id: 'o1', name: 'Acme', urn: 'hrn:mem:acme.com' },
  { id: 'o2', name: 'Globex', urn: 'hrn:mem:globex.com' },
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function openInHost() {
  const m = mountComponent(EscapeHostHarness, {
    child: SelectOrg,
    childProps: { orgs, onselect: () => {}, open: true },
  });
  mounted.push(m);
  return m;
}

const hostDialog = () => document.querySelector<HTMLElement>('[data-host-dialog]');
const pickerOverlay = () => document.querySelector<HTMLElement>('.fixed.inset-0');

function pressEscape(from: EventTarget = document.activeElement ?? document.body) {
  from.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

describe('SelectOrg: Escape closes one layer only (#1584)', () => {
  it('one Escape inside the picker closes the picker, not the host dialog around it', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above); // registered before the picker opened
    try {
      openInHost();
      await tick(2);
      expect(pickerOverlay()).not.toBeNull();
      const input = pickerOverlay()!.querySelector('input');
      input!.focus(); // a real press starts at the search box
      pressEscape();
      flushSync();
      expect(pickerOverlay()).toBeNull(); // exactly one layer closed: the picker's
      expect(hostDialog()).not.toBeNull(); // the host keeps its layer
      expect(above).not.toHaveBeenCalled(); // the earlier-registered listener never fired
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('Escape with focus outside the picker still closes it — the fallback, shielding the host', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above);
    try {
      openInHost();
      await tick(2);
      (document.activeElement as HTMLElement | null)?.blur?.(); // focus never entered the picker
      expect(document.activeElement).toBe(document.body);
      pressEscape(); // from <body>: only the window fallback can own this key
      flushSync();
      expect(pickerOverlay()).toBeNull();
      expect(hostDialog()).not.toBeNull();
      expect(above).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', above);
    }
  });
});
