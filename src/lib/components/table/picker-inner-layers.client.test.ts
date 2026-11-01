/**
 * #1584 fold — the innermost open layer owns Escape, even inside a picker,
 * WHEREVER FOCUS SITS (#1587 review: LOCAL P2 + BLIND P2, Gemma P3-1).
 *
 * The table header's floating layers (the ViewTabs saved-view caret menu, the
 * ColumnToggle Columns dropdown) close on Escape through DOCUMENT-bubble
 * listeners. Under a #1584 dialog — whose element consumes Escape with
 * stopPropagation — the dialog's bubble handler outranks `document`, so one
 * press would dismiss the whole picker (and with it every loaded page of
 * results) while the menu the user meant to close never sees the key.
 *
 * Element consumption at the layer's own element is not enough on its own: it
 * covers only a focus INSIDE the layer. Nothing moves focus into the caret
 * menu on open — the opener (mouse or keyboard) leaves focus on the CARET
 * BUTTON — and a dropdown can stay open while focus sits on another control
 * or on <body>. In every one of those positions the open inner layer, not the
 * dialog around it, must take the key: the layer arms the shared CAPTURE
 * fallback (`dialogEscapeFallback`), whose armed stack makes the layer opened
 * last the topmost, so it resolves the key at window-capture before any
 * dialog element handler can bubble — the same mechanism stacked dialogs use.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import DialogTableHarness from '$lib/test/DialogTableHarness.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

// ViewTabs renders tabs (and the caret) only for SAVED views: a fresh listKey
// has none. Seed one default view the way the real store reads it
// (localStorageViewStore's records key, LocalStorageViewStore.readRecords).
const LIST_KEY = 'test:inner-layers';
const VIEWS_KEY = `hadron:views:v1:${LIST_KEY}`;
beforeEach(() => {
  localStorage.setItem(VIEWS_KEY, JSON.stringify([{
    id: 'v-default', listKey: LIST_KEY, name: 'Default', view: {},
    isDefault: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  }]));
});
afterEach(() => localStorage.removeItem(VIEWS_KEY));

async function mountDialog() {
  const m = mountComponent(DialogTableHarness as never, {} as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(5); // ViewTabs loads its saved views in onMount
  return m;
}

const dialog = () => document.querySelector<HTMLElement>('[data-picker-dialog]');
const caret = () => document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const columnsDetails = () => document.querySelector<HTMLDetailsElement>('details');

function escapeAt(el: Element) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
}

describe('a picker dialog hosting a DataTable: inner layers own Escape (#1584 fold)', () => {
  it('the saved-view caret menu: Escape closes the MENU, the picker stays', async () => {
    await mountDialog();
    expect(caret()).not.toBeNull(); // oracle: there is a caret to open a menu
    caret()!.click();
    flushSync();
    expect(menu()).not.toBeNull(); // the menu is open
    const item = menu()!.querySelector('button')!;
    item.focus();
    escapeAt(item);
    expect(menu()).toBeNull(); // the innermost layer took the key
    expect(dialog()).not.toBeNull(); // the picker keeps its layer
  });

  it("the caret menu at the OPENER's focus state: focus stays on the caret, and Escape still closes only the menu (#1587 LOCAL P2)", async () => {
    // Gemma's probe: nothing moves focus into the menu on open — no focus()
    // anywhere in ViewTabs — so after the click that opens it focus is on the
    // CARET BUTTON, outside the menu element. A pin that focuses a menu item
    // first pins a focus state a mouse or keyboard opener never produces.
    await mountDialog();
    caret()!.focus();
    caret()!.click(); // the opener's real focus state: focus left on the caret
    flushSync();
    expect(menu()).not.toBeNull(); // the menu is open
    expect(document.activeElement).toBe(caret()!); // oracle: focus never entered the menu
    escapeAt(document.activeElement!);
    expect(menu()).toBeNull(); // the open inner layer took the key
    expect(dialog()).not.toBeNull(); // the picker keeps its layer
    // One layer per press: with the menu gone, the NEXT Escape is the
    // picker's — the dialog-level consumption above is still live.
    escapeAt(caret()!);
    expect(dialog()).toBeNull();
  });

  it('caret menu open, focus on ANOTHER control in the picker: Escape closes the menu, not the picker (#1587 BLIND P2)', async () => {
    // Gizelle's case: the menu stays open while focus moves elsewhere inside
    // the picker (here the Columns summary). Target containment must not
    // decide who owns the key — the open layer owns it.
    await mountDialog();
    caret()!.click();
    flushSync();
    expect(menu()).not.toBeNull();
    const summary = columnsDetails()!.querySelector('summary')!;
    summary.focus();
    escapeAt(summary);
    expect(menu()).toBeNull(); // the menu took the key
    expect(dialog()).not.toBeNull(); // the picker keeps its layer
  });

  it('caret menu open, focus stranded on <body>: Escape closes the menu, not the picker (#1587 LOCAL P3-1)', async () => {
    await mountDialog();
    caret()!.click();
    flushSync();
    expect(menu()).not.toBeNull();
    escapeAt(document.body);
    expect(menu()).toBeNull(); // the innermost OPEN layer takes a body-focus key
    expect(dialog()).not.toBeNull(); // ...not the picker under it
  });

  it('the Columns dropdown: Escape closes the DROPDOWN, the picker stays', async () => {
    await mountDialog();
    const details = columnsDetails()!;
    expect(details).not.toBeNull(); // oracle: the toggle renders
    details.querySelector('summary')!.click();
    // jsdom toggles the open attribute but never fires the `toggle` event
    // (verified: 0 events on a summary click), so bind:open's state would
    // stay closed and the dropdown would suppress a key it owns. Deliver the
    // browser's half of the pair — the same jsdom-gap pattern as the
    // focus-trap suite's offsetWidth spy.
    details.dispatchEvent(new Event('toggle'));
    flushSync();
    expect(details.open).toBe(true); // the dropdown is open
    const box = details.querySelector('input')!;
    box.focus();
    escapeAt(box);
    expect(details.open).toBe(false); // the innermost layer took the key
    expect(dialog()).not.toBeNull(); // the picker keeps its layer
  });

  it('dropdown open, focus on ANOTHER control in the picker: Escape closes the dropdown, not the picker (#1587 BLIND P2)', async () => {
    // The dropdown stays open while focus sits on another picker control
    // (the saved-view caret). Target containment must not decide ownership.
    await mountDialog();
    const details = columnsDetails()!;
    details.querySelector('summary')!.click();
    details.dispatchEvent(new Event('toggle')); // jsdom's missing half (see above)
    flushSync();
    expect(details.open).toBe(true);
    caret()!.focus();
    escapeAt(caret()!);
    expect(details.open).toBe(false); // the dropdown took the key
    expect(dialog()).not.toBeNull(); // the picker keeps its layer
  });

  it('dropdown open, focus stranded on <body>: Escape closes the dropdown, not the picker (#1587 LOCAL P3-1)', async () => {
    await mountDialog();
    const details = columnsDetails()!;
    details.querySelector('summary')!.click();
    details.dispatchEvent(new Event('toggle')); // jsdom's missing half (see above)
    flushSync();
    expect(details.open).toBe(true);
    escapeAt(document.body);
    expect(details.open).toBe(false); // the innermost OPEN layer takes it
    expect(dialog()).not.toBeNull(); // ...not the picker under it
  });

  it("with no inner layer open, the dialog's own consumption still closes the picker", async () => {
    // The positive control: the dialog really does consume Escape at its
    // layer — the two pins above cannot pass because the dialog is deaf.
    await mountDialog();
    expect(menu()).toBeNull();
    expect(columnsDetails()!.open).toBe(false);
    const summary = columnsDetails()!.querySelector('summary')!;
    summary.focus();
    escapeAt(summary);
    expect(dialog()).toBeNull();
  });
});
