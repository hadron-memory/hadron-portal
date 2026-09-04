// @vitest-environment jsdom
//
// The suite default is `environment: 'node'` and stays that way — this pragma
// opts in THIS FILE only, so the other 160-odd node-env test files pay nothing
// for the DOM. Per hrn:node:hadronmemory.com:hadron-portal:conventions:svelte-component-test-gap that gap is meant to be
// closed deliberately rather than silently, so: this is the minimal increment
// (jsdom + one pragma), NOT the full component-testing setup that node describes.
// `focus-trap.ts` is a plain TS module over DOM nodes, not a Svelte component, so
// it needs no testing-library, no `.svelte` glob, and no vitest project split.
/**
 * PR #697 review (codex): `aria-modal="true"` is a promise to assistive tech, not
 * a mechanism — the browser still lets Tab walk out of the dialog into the page
 * behind it. These pin the three jobs the action has to do.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { focusTrap } from './focus-trap';

let opener: HTMLButtonElement;
let dialog: HTMLDivElement;

// `cancelable: true` is load-bearing: preventDefault() on a non-cancelable event
// is a silent no-op, so `defaultPrevented` would read false no matter what the
// handler did — and the "does not intercept Tab in the middle" assertion below
// would pass vacuously. Real browsers dispatch key events as cancelable.
function tabKey(shift = false) {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';

  // The control that "opened" the dialog, plus a sibling the trap must not let
  // Tab reach.
  opener = document.createElement('button');
  opener.textContent = 'Actions';
  const behind = document.createElement('button');
  behind.textContent = 'Delete node';
  behind.id = 'behind';
  document.body.append(opener, behind);
  opener.focus();

  dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = `
    <button id="first">Upload</button>
    <button id="mid">Pick</button>
    <button id="last">Close</button>
  `;
  document.body.append(dialog);

  // jsdom reports every element as zero-size, so the visibility filter would
  // drop everything. Give the buttons a box.
  for (const el of dialog.querySelectorAll('button')) {
    Object.defineProperty(el, 'offsetWidth', { value: 10, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 10, configurable: true });
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('focusTrap', () => {
  it('moves focus into the dialog on mount', () => {
    focusTrap(dialog);
    expect(document.activeElement).toBe(byId('first'));
  });

  it('wraps Tab from the last control back to the first', () => {
    focusTrap(dialog);
    byId('last').focus();
    dialog.dispatchEvent(tabKey());
    expect(document.activeElement).toBe(byId('first'));
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    focusTrap(dialog);
    byId('first').focus();
    dialog.dispatchEvent(tabKey(true));
    expect(document.activeElement).toBe(byId('last'));
  });

  it('does not intercept Tab in the middle of the dialog', () => {
    focusTrap(dialog);
    byId('mid').focus();
    const ev = tabKey();
    dialog.dispatchEvent(ev);
    // Left to the browser's own sequencing — the trap only closes the loop.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('pulls focus back when it lands outside the dialog', () => {
    focusTrap(dialog);
    // A click (or a stray programmatic focus) on the page behind the overlay —
    // keydown handling alone cannot see this.
    byId('behind').focus();
    byId('behind').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(byId('first'));
  });

  it('restores focus to the opener on destroy', () => {
    const trap = focusTrap(dialog);
    expect(document.activeElement).toBe(byId('first'));
    trap.destroy();
    expect(document.activeElement).toBe(opener);
  });

  it('does not yank focus back if the user already moved on', () => {
    const trap = focusTrap(dialog);
    const elsewhere = byId('behind');
    // Simulate the dialog closing AFTER focus legitimately moved away: detach
    // the dialog first so `contains` is false, as it would be mid-teardown.
    dialog.remove();
    elsewhere.focus();
    trap.destroy();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('focuses the container itself when the dialog has nothing tabbable', () => {
    const empty = document.createElement('div');
    empty.setAttribute('role', 'dialog');
    document.body.append(empty);
    focusTrap(empty);
    // The point is that focus leaves the page behind the overlay, even with no
    // controls to land on.
    expect(document.activeElement).toBe(empty);
    expect(empty.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps Tab inside a dialog with nothing tabbable', () => {
    const empty = document.createElement('div');
    document.body.append(empty);
    focusTrap(empty);
    const ev = tabKey();
    empty.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('skips disabled controls when choosing where to land', () => {
    byId('first').setAttribute('disabled', '');
    focusTrap(dialog);
    expect(document.activeElement).toBe(byId('mid'));
  });

  it('stops trapping after destroy', () => {
    const trap = focusTrap(dialog);
    trap.destroy();
    byId('behind').focus();
    byId('behind').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(byId('behind'));
  });
});
