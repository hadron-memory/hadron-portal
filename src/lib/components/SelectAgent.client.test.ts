/**
 * #1279 — the agent picker is a real dialog: role, modal flag, accessible
 * name and a focusable panel on the opened modal (the SelectApp.svelte:38
 * pattern), with Esc-close, focus-on-open, opener-restore and the pick flow
 * still holding.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
import SelectAgent from './SelectAgent.svelte';

const agents = [
  { id: 'a1', name: 'Atlas', urn: 'hrn:agent:acme.com:team:atlas', description: 'maps things' },
  { id: 'a2', name: 'Boreas', urn: 'hrn:agent:acme.com:team:boreas', description: null },
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

function openModal(onselect: (a: unknown) => void = () => {}) {
  const props = reactiveProps<Record<string, unknown>>({ agents, onselect, open: true });
  const m = mountComponent(SelectAgent as never, props as never) as Mounted<Record<string, unknown>>;
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


// jsdom lays out nothing: every element reports a zero-size box, so the trap's
// rendered-ness filter would drop every control and it could neither focus the
// search input nor cycle Tab. Give elements a box for one test (the focus-trap
// suite mocks the same thing per element; a prototype spy also covers the
// elements the mount creates).
const mockLayout = () =>
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);

describe('SelectAgent: dialog semantics (#1279)', () => {
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
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      expect(document.activeElement).toBe(searchInput());
    } finally {
      box.mockRestore();
    }
  });

  it('focus returns to the opener when the dialog closes on Escape', async () => {
    // portal#1305 review P2: the input's own focus action ran before the
    // parent trap captured the opener, so the trap recorded the search input
    // and restore was lost — Escape left focus on <body>.
    const box = mockLayout();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      openModal();
      await tick(2);
      // The trap captured the opener, then moved focus into the dialog.
      expect(document.activeElement).toBe(searchInput());
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(overlay()).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      box.mockRestore();
    }
  });

  it('Tab wraps from the last control back to the search input', async () => {
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      const selectButtons = [...document.querySelectorAll<HTMLButtonElement>('.fixed.inset-0 button')]
        .filter((b) => b.textContent?.trim() === 'Select');
      const last = selectButtons[selectButtons.length - 1];
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      flushSync();
      expect(document.activeElement).toBe(searchInput());
    } finally {
      box.mockRestore();
    }
  });

  // #1313 — the reverse half of the trap. Shift+Tab from the FIRST control
  // (the search input) must wrap to the LAST enabled tabbable control inside
  // this dialog, not walk out to the page behind. A forward-only trap passes
  // every test above and fails only this one.
  it('Shift+Tab wraps from the search input to the last control', async () => {
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      const controls = [...dialog()!.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
        .filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
      const last = controls[controls.length - 1];
      // Guard the oracle: the expectation must be a real control that is not the input itself.
      expect(last).toBeDefined();
      expect(last).not.toBe(searchInput());
      expect(last.textContent?.trim()).toBe('Select');
      searchInput()!.focus();
      expect(document.activeElement).toBe(searchInput());
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      searchInput()!.dispatchEvent(event);
      flushSync();
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    } finally {
      box.mockRestore();
    }
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
    openModal((a) => { picked = a; });
    await tick(2);
    expect(overlay()!.textContent).toContain('Atlas');
    selectButton().click();
    flushSync();
    expect(picked).toStrictEqual(agents[0]);
    expect(overlay()).toBeNull();
  });
});

describe('SelectAgent: Escape closes one layer only (#1584)', () => {
  const hostDialog = () => document.querySelector<HTMLElement>('[data-host-dialog]');

  function openInHost() {
    const m = mountComponent(EscapeHostHarness, {
      child: SelectAgent,
      childProps: { agents, onselect: () => {}, open: true },
    });
    mounted.push(m);
    return m;
  }

  it('one Escape inside the picker closes the picker, not the host dialog around it', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above); // registered before the picker opened
    let host: ReturnType<typeof openInHost>;
    try {
      host = openInHost();
      await tick(2);
      expect(overlay()).not.toBeNull();
      const input = overlay()!.querySelector('input');
      input!.focus(); // a real press starts at the search box
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      flushSync();
      expect(overlay()).toBeNull(); // exactly one layer closed: the picker's
      expect(hostDialog()).not.toBeNull(); // the host keeps its layer
      expect(above).not.toHaveBeenCalled(); // the earlier-registered listener never fired
      expect((host.instance.hostEscapes as () => number)()).toBe(0); // the host's own listener never fired
      // Positive control at this same position: the host's listener is LIVE —
      // the next press, with nothing left to consume it, closes the host.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
      expect(hostDialog()).toBeNull();
      expect((host.instance.hostEscapes as () => number)()).toBe(1);
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('Escape with focus outside the picker still closes it — the fallback, shielding the host', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above);
    let host: ReturnType<typeof openInHost>;
    try {
      host = openInHost();
      await tick(2);
      (document.activeElement as HTMLElement | null)?.blur?.(); // focus never entered the picker
      expect(document.activeElement).toBe(document.body);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      flushSync();
      expect(overlay()).toBeNull();
      expect(hostDialog()).not.toBeNull();
      expect(above).not.toHaveBeenCalled();
      expect((host.instance.hostEscapes as () => number)()).toBe(0);
    } finally {
      window.removeEventListener('keydown', above);
    }
  });
});
