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
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
import SelectOrg from './SelectOrg.svelte';
import { clearDictionary, rowSelectButtons, usePickerLocale } from '$lib/test/i18n-dictionary';

// #1605: a test locale on the t() boundary; empty, t() is unchanged.
vi.mock('$lib/i18n/t', async (importOriginal) =>
  (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));

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
    let host: ReturnType<typeof openInHost>;
    try {
      host = openInHost();
      await tick(2);
      expect(pickerOverlay()).not.toBeNull();
      const input = pickerOverlay()!.querySelector('input');
      input!.focus(); // a real press starts at the search box
      pressEscape();
      flushSync();
      expect(pickerOverlay()).toBeNull(); // exactly one layer closed: the picker's
      expect(hostDialog()).not.toBeNull(); // the host keeps its layer
      expect(above).not.toHaveBeenCalled(); // the earlier-registered listener never fired
      expect((host.instance.hostEscapes as () => number)()).toBe(0); // the host's own listener never fired
      // Positive control at this same position: the host's listener is LIVE —
      // the next press, with nothing left to consume it, closes the host.
      pressEscape(document.body);
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
      pressEscape(); // from <body>: only the window fallback can own this key
      flushSync();
      expect(pickerOverlay()).toBeNull();
      expect(hostDialog()).not.toBeNull();
      expect(above).not.toHaveBeenCalled();
      expect((host.instance.hostEscapes as () => number)()).toBe(0);
    } finally {
      window.removeEventListener('keydown', above);
    }
  });
});

describe('SelectOrg is announced as a modal dialog (#1589)', () => {
  it('the picker panel carries role="dialog", aria-modal="true" and the family accessible name', () => {
    openInHost();
    flushSync();
    const panel = pickerOverlay()!.firstElementChild as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Choose an organization');
    // The Escape consumption is on that same element: the dialog layer the shared pattern names.
    expect(pickerOverlay()!.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

// portal#1599 — the picker PROMISES aria-modal, so it must trap focus: the
// open dialog keeps Tab cycling inside it and hands focus back to the trigger
// on close. Same pins as SelectAgent/SelectMemory (#1305/#1313), bare-mounted
// because the opener-restore pin needs a focused element OUTSIDE the dialog,
// which the #1584 host harness doesn't provide.
describe('SelectOrg: the aria-modal promise is kept — focus is trapped (#1599)', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const searchInput = () => document.querySelector<HTMLInputElement>('.fixed.inset-0 input');

  // jsdom lays out nothing, so the trap's rendered-ness filter would drop every
  // control; give elements a box (same mock as the focus-trap suite).
  const mockLayout = () =>
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);

  function openModal() {
    const props = reactiveProps<Record<string, unknown>>({ orgs, onselect: () => {}, open: true });
    const m = mountComponent(SelectOrg as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    return m;
  }

  function tabbables() {
    return [...dialog()!.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
  }

  it('on open, focus is inside the dialog', async () => {
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    } finally {
      box.mockRestore();
    }
  });

  it('Tab from the last tabbable control wraps to the first', async () => {
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      // Two orgs fit one page, so BOTH footer buttons are disabled and drop out
      // of the tabbable set — the last row's Select is the last tabbable.
      const last = tabbables().at(-1)!;
      expect(last.textContent).toContain('Select');
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      flushSync();
      expect(document.activeElement).toBe(searchInput());
    } finally {
      box.mockRestore();
    }
  });

  it('Shift+Tab from the first tabbable control wraps to the last', async () => {
    const box = mockLayout();
    try {
      openModal();
      await tick(2);
      const last = tabbables().at(-1)!;
      // Guard the oracle: the wrap target must be a real control, not the input itself.
      expect(last.textContent).toContain('Select');
      expect(searchInput()!).not.toBe(last);
      searchInput()!.focus();
      searchInput()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
      flushSync();
      expect(document.activeElement).toBe(last);
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    } finally {
      box.mockRestore();
    }
  });

  it('Escape closes the picker and focus returns to the trigger that opened it', async () => {
    const box = mockLayout();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      openModal();
      await tick(2);
      expect(dialog()!.contains(document.activeElement)).toBe(true); // the trap took focus in
      pressEscape(); // from the focused control inside the dialog
      flushSync();
      expect(pickerOverlay()).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      box.mockRestore();
    }
  });
});

// #1605: the per-row Select is localized and carries a distinct accessible
// name per row (WCAG label-in-name: it starts with the visible label), so a
// screen-reader user tabbing the list hears which entity each one picks.
describe('SelectOrg: per-row Select (#1605)', () => {
  afterEach(clearDictionary);
  it('is localized and named after its organization', async () => {
    usePickerLocale();
    const props = reactiveProps<Record<string, unknown>>({ orgs, onselect: () => {}, open: true });
    mounted.push(mountComponent(SelectOrg as never, props as never) as Mounted<Record<string, unknown>>);
    await tick(2);
    const buttons = rowSelectButtons('.fixed.inset-0 tbody tr');
    const names = orgs.map((x) => x.name);
    for (const b of buttons) expect(b.textContent?.trim()).toBe('Wählen');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toStrictEqual(names.map((n) => `Wähle ${n}`));
    expect(new Set(buttons.map((b) => b.getAttribute('aria-label'))).size).toBe(names.length);
    // The 44px coarse-pointer target (jsdom has no layout; the real-Chromium
    // stacked layout script measures SelectMemory's).
    for (const b of buttons) expect(b.classList.contains('pointer-coarse:min-h-11')).toBe(true);
  });
});
