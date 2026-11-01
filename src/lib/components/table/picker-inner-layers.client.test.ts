/**
 * #1584 fold — the innermost open layer owns Escape, even inside a picker.
 *
 * The table header's floating layers (the ViewTabs saved-view caret menu, the
 * ColumnToggle Columns dropdown) close on Escape through DOCUMENT-bubble
 * listeners. Under a #1584 dialog — whose element consumes Escape with
 * stopPropagation — the dialog's bubble handler outranks `document`, so one
 * press would dismiss the whole picker (and with it every loaded page of
 * results) while the menu the user meant to close never sees the key. The
 * inner layers must consume the key at their OWN element, the same shared
 * helper the dialogs use.
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
