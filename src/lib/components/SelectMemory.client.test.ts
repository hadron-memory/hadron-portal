/**
 * #1279 — the memory picker is a real dialog: role, modal flag, accessible
 * name and a focusable panel on the opened modal (the SelectApp.svelte:38
 * pattern), with Esc-close, focus-on-open, opener-restore and the pick flow
 * still holding.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import SelectMemory from './SelectMemory.svelte';
import { clearDictionary, rowSelectButtons, usePickerLocale } from '$lib/test/i18n-dictionary';

// #1605: a test locale on the t() boundary; empty, t() is unchanged.
vi.mock('$lib/i18n/t', async (importOriginal) =>
  (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));

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


// jsdom lays out nothing: every element reports a zero-size box, so the trap's
// rendered-ness filter would drop every control and it could neither focus the
// search input nor cycle Tab. Give elements a box for one test (the focus-trap
// suite mocks the same thing per element; a prototype spy also covers the
// elements the mount creates).
const mockLayout = () =>
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);

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

  it('rows render and Select picks the memory and closes', async () => {
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

// portal#1600 items 1 and 4. Item 1: the panel names itself visibly, so a
// stacked memory panel under SelectNode's "Choose a node" header is not
// mistaken for it. Item 4: the clearOf host can move under the open overlay
// by scrolling (a scroll chaining from the memory list to the node dialog),
// so a scroll anywhere re-measures, not just open and resize.
describe('SelectMemory: visible title and clearOf scroll re-measure (#1600)', () => {
  // jsdom has no layout, so this proves the heading exists and names the
  // dialog, not that it is visible; the real-Chromium layout script
  // (scripts/test-stacked-memory-layout.mjs) owns visibility (#1606 item 2).
  it('renders a "Choose a memory" h2 that is also the dialog\'s accessible name', async () => {
    openModal();
    await tick(2);
    const heading = dialog()!.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading!.textContent?.trim()).toBe('Choose a memory');
    expect(dialog()!.getAttribute('aria-label')).toBe(heading!.textContent?.trim());
  });

  function hostAt(bottom: { value: number }) {
    const host = document.createElement('div');
    document.body.append(host);
    const rect = vi.spyOn(host, 'getBoundingClientRect').mockImplementation(
      () => ({ bottom: bottom.value, top: 0, left: 0, right: 0, width: 0, height: bottom.value, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    return { host, rect };
  }

  function openStacked(host: HTMLElement) {
    const props = reactiveProps<Record<string, unknown>>({ memories, onselect: () => {}, open: true, clearOf: host });
    const m = mountComponent(SelectMemory as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    return { m, props };
  }

  it('a scroll on any element re-measures the host edge while open', async () => {
    const bottom = { value: 100 };
    const { host } = hostAt(bottom);
    try {
      openStacked(host);
      await tick(2);
      expect(overlay()!.style.paddingTop).toBe('max(10vh, 108px)');
      // The host header moves (scroll chaining); scroll does not bubble, so
      // only a capture-phase listener sees a scroll on an inner scroller.
      bottom.value = 200;
      const scroller = dialog()!.querySelector('.overflow-auto')!;
      scroller.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(overlay()!.style.paddingTop).toBe('max(10vh, 208px)');
    } finally {
      host.remove();
    }
  });

  it('after close and after unmount a scroll no longer measures the host', async () => {
    const bottom = { value: 100 };
    const { host, rect } = hostAt(bottom);
    try {
      const { m, props } = openStacked(host);
      await tick(2);
      // Oracle: while open, a scroll does measure (so the zero below means something).
      const before = rect.mock.calls.length;
      document.dispatchEvent(new Event('scroll'));
      expect(rect.mock.calls.length).toBeGreaterThan(before);

      props.open = false;
      flushSync();
      const afterClose = rect.mock.calls.length;
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      expect(rect.mock.calls.length).toBe(afterClose);

      props.open = true;
      flushSync();
      m.unmount();
      mounted.splice(mounted.indexOf(m), 1);
      const afterUnmount = rect.mock.calls.length;
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      expect(rect.mock.calls.length).toBe(afterUnmount);
    } finally {
      host.remove();
    }
  });
});

// #1604 item 1: on phones the Organization column folds under the memory
// name. A memory with no org rendered a bare "—" there: an unlabelled stray
// glyph under the name. The folded line renders only when there is an org;
// the desktop column (its own cell, hidden below sm) keeps its "—".
describe('SelectMemory: folded org line on phones (#1604)', () => {
  const withOrg = [
    { id: 'm1', name: 'Atlas KB', urn: 'hrn:mem:acme.com:atlas', orgName: '' },
    { id: 'm2', name: 'Boreas KB', urn: 'hrn:mem:acme.com:boreas', orgName: 'Acme Inc' },
  ];

  function rowFor(name: string) {
    return [...document.querySelectorAll<HTMLTableRowElement>('.fixed.inset-0 tbody tr')].find((tr) => tr.textContent?.includes(name))!;
  }

  it('a no-org row has no folded line under the name, and its desktop cell keeps the dash', async () => {
    const props = reactiveProps<Record<string, unknown>>({ memories: withOrg, onselect: () => {}, open: true });
    mounted.push(mountComponent(SelectMemory as never, props as never) as Mounted<Record<string, unknown>>);
    await tick(2);
    const cells = rowFor('Atlas KB').querySelectorAll('td');
    expect(cells[0].textContent).not.toContain('—');
    expect(cells[0].querySelector('div')).toBeNull();
    expect(cells[2].textContent?.trim()).toBe('—');
  });

  it('a row with an org still folds its org name under the name', async () => {
    const props = reactiveProps<Record<string, unknown>>({ memories: withOrg, onselect: () => {}, open: true });
    mounted.push(mountComponent(SelectMemory as never, props as never) as Mounted<Record<string, unknown>>);
    await tick(2);
    const cells = rowFor('Boreas KB').querySelectorAll('td');
    expect(cells[0].querySelector('div')?.textContent?.trim()).toBe('Acme Inc');
    expect(cells[2].textContent?.trim()).toBe('Acme Inc');
  });
});

// #1605: the per-row Select is localized and carries a distinct accessible
// name per row (WCAG label-in-name: it starts with the visible label), so a
// screen-reader user tabbing the list hears which entity each one picks.
describe('SelectMemory: per-row Select (#1605)', () => {
  afterEach(clearDictionary);
  it('is localized and named after its memory', async () => {
    usePickerLocale();
    openModal();
    await tick(2);
    const buttons = rowSelectButtons('.fixed.inset-0 tbody tr');
    const names = memories.map((x) => x.name);
    for (const b of buttons) expect(b.textContent?.trim()).toBe('Wählen');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toStrictEqual(names.map((n) => `Wähle ${n}`));
    expect(new Set(buttons.map((b) => b.getAttribute('aria-label'))).size).toBe(names.length);
    // The 44px coarse-pointer target (jsdom has no layout; the real-Chromium
    // stacked layout script measures SelectMemory's).
    for (const b of buttons) expect(b.classList.contains('pointer-coarse:min-h-11')).toBe(true);
  });
});
