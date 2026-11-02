/**
 * portal#1584 — SelectApp's Escape layering, mounted (CLIENT lane). Opened
 * inside a host dialog whose own window-bubble Escape listener registered
 * FIRST (the pre-#1582 pattern), one keypress must close ONE layer: the
 * picker, never the host, and the host's earlier-registered listener must
 * never fire. The window listener survives only as the shared CAPTURE
 * fallback for a focus that never entered the picker — which shields the
 * host the same way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
import SelectApp from './SelectApp.svelte';
import { clearDictionary, rowSelectButtons, usePickerLocale } from '$lib/test/i18n-dictionary';

// #1605: a test locale on the t() boundary; empty, t() is unchanged.
vi.mock('$lib/i18n/t', async (importOriginal) =>
  (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));

const apps = [
  { id: 'app1', name: 'Portal', urn: 'hrn:app:example.com:portal' },
  { id: 'app2', name: 'Team', urn: 'hrn:app:example.com:team' },
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function openInHost() {
  const m = mountComponent(EscapeHostHarness, {
    child: SelectApp,
    childProps: { apps, scopeKey: "test", onselect: () => {}, open: true },
  });
  mounted.push(m);
  return m;
}

// Role-independent: every picker renders a .fixed.inset-0 overlay when open,
// whether or not it carries role="dialog".
const hostDialog = () => document.querySelector<HTMLElement>('[data-host-dialog]');
const pickerOverlay = () => document.querySelector<HTMLElement>('.fixed.inset-0');

// A keydown from the focused control, as a real keypress travels: it bubbles.
function pressEscape(from: EventTarget = document.activeElement ?? document.body) {
  from.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

describe('SelectApp: Escape closes one layer only (#1584)', () => {
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

// #1605: the per-row Select is localized and carries a distinct accessible
// name per row (WCAG label-in-name: it starts with the visible label), so a
// screen-reader user tabbing the list hears which entity each one picks.
describe('SelectApp: per-row Select (#1605)', () => {
  afterEach(clearDictionary);
  it('keeps its localized label and is named after its App', async () => {
    usePickerLocale();
    openInHost();
    await tick(2);
    const buttons = rowSelectButtons('.fixed.inset-0 tbody tr');
    const names = apps.map((x) => x.name);
    for (const b of buttons) expect(b.textContent?.trim()).toBe('Select');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toStrictEqual(names.map((n) => `Wähle ${n}`));
    expect(new Set(buttons.map((b) => b.getAttribute('aria-label'))).size).toBe(names.length);
    // The 44px coarse-pointer target (jsdom has no layout; the real-Chromium
    // stacked layout script measures SelectMemory's).
    for (const b of buttons) expect(b.classList.contains('pointer-coarse:min-h-11')).toBe(true);
  });
});
