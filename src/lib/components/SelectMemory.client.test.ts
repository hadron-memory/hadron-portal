/**
 * #1279 — the memory picker is a real dialog: role, modal flag, accessible
 * name and a focusable panel on the opened modal (the SelectApp.svelte:38
 * pattern), with Esc-close, focus-on-open and the pick flow still holding.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import SelectMemory from './SelectMemory.svelte';

const memories = [
  { id: 'm1', name: 'Atlas KB', urn: 'hrn:mem:acme.com:atlas', visibility: 'PRIVATE' },
  { id: 'm2', name: 'Boreas KB', urn: 'hrn:mem:acme.com:boreas', visibility: null },
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

function openModal(onselect: (a: unknown) => void = () => {}) {
  const props = reactiveProps<Record<string, unknown>>({ memories, onselect, open: true });
  const m = mountComponent(SelectMemory as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

// Role-independent presence checks: on main (pre-#1279) there is no
// [role="dialog"], and the behaviour tests must still pass there — only the
// semantics test is allowed to be red.
const overlay = () => document.querySelector<HTMLElement>('.fixed.inset-0');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const searchInput = () => document.querySelector<HTMLInputElement>('.fixed.inset-0 input');
const selectButton = () => [...document.querySelectorAll<HTMLButtonElement>('.fixed.inset-0 button')]
  .find((b) => b.textContent?.trim() === 'Select')!;

describe('SelectMemory: dialog semantics (#1279)', () => {
  it('the opened panel is a labelled, modal, focusable dialog', async () => {
    openModal();
    await tick(2);
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d!.getAttribute('aria-modal')).toBe('true');
    expect((d!.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
    expect(d!.getAttribute('tabindex')).toBe('-1');
  });

  it('focus lands on the search input when the modal opens', async () => {
    openModal();
    await tick(2);
    expect(document.activeElement).toBe(searchInput());
  });

  it('Escape closes the modal', async () => {
    openModal();
    await tick(2);
    expect(overlay()).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(overlay()).toBeNull();
  });

  it('rows render and Select picks the agent and closes', async () => {
    let picked: unknown = null;
    openModal((m) => { picked = m; });
    await tick(2);
    expect(overlay()!.textContent).toContain('Atlas KB');
    selectButton().click();
    flushSync();
    expect(picked).toStrictEqual(memories[0]);
    expect(overlay()).toBeNull();
  });
});
