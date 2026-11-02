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
import { focusTrap, focusTrapWhen } from './focus-trap';

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

/**
 * The boolean-driven form, for a container that stays mounted while it opens
 * and closes (the maximised team chat). Same three jobs, engaged on `true` and
 * released on `false`; the tests here pin the switching, not the trap itself.
 */
describe('focusTrapWhen', () => {
  it('does nothing while inactive', () => {
    focusTrapWhen(dialog, false);
    expect(document.activeElement).toBe(opener);
    byId('behind').focus();
    byId('behind').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(byId('behind'));
  });

  it('engages the trap when switched on: focus moves in and Tab cycles', () => {
    const action = focusTrapWhen(dialog, false);
    action.update(true);
    expect(document.activeElement).toBe(byId('first'));
    byId('last').focus();
    const ev = tabKey();
    byId('last').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));
  });

  it('releases the trap and restores the opener when switched off', () => {
    const action = focusTrapWhen(dialog, true);
    expect(document.activeElement).toBe(byId('first'));
    action.update(false);
    expect(document.activeElement).toBe(opener);
    // And the page behind is reachable again.
    byId('behind').focus();
    byId('behind').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(byId('behind'));
  });

  // Toggling twice must not stack two traps — the second `true` is a no-op.
  it('is idempotent on repeated updates with the same value', () => {
    const action = focusTrapWhen(dialog, true);
    action.update(true);
    action.update(false);
    expect(document.activeElement).toBe(opener);
    action.update(false);
    expect(document.activeElement).toBe(opener);
  });

  it('releases an active trap on destroy', () => {
    const action = focusTrapWhen(dialog, true);
    action.destroy();
    expect(document.activeElement).toBe(opener);
  });
});

/**
 * #938 — text in a trapped dialog must stay selectable.
 *
 * A mousedown on non-interactive content focuses its nearest focusable
 * ANCESTOR (the browser's default). The maximised team chat lives inside a
 * focusable tab panel (`tabindex="0"`), so clicking message text focused that
 * panel, OUTSIDE the dialog. The trap then pulled focus back in mid-mousedown,
 * which cancels Chrome's text-selection drag. jsdom has no mousedown-to-focus
 * default, so `clickFocus` performs exactly that step.
 */
describe('focusTrap — clicking text inside the dialog (#938)', () => {
  /** What the browser does to focus on a mousedown at `target`. */
  function clickFocus(target: HTMLElement) {
    let el: HTMLElement | null = target;
    while (el && !el.hasAttribute('tabindex') && !el.matches('a[href],button,input,select,textarea')) {
      el = el.parentElement;
    }
    const focusTarget = el ?? document.body;
    focusTarget.focus();
    focusTarget.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return focusTarget;
  }

  function inFocusablePanel() {
    // The real shape: the tab panel is focusable and CONTAINS the dialog.
    const panel = document.createElement('div');
    panel.setAttribute('tabindex', '0');
    panel.id = 'panel-chats';
    document.body.append(panel);
    panel.append(dialog);
    const text = document.createElement('p');
    text.textContent = 'a message body the reader wants to copy';
    dialog.append(text);
    return { panel, text };
  }

  it('a click on text lands on the dialog itself, and the trap leaves it there', () => {
    const { panel, text } = inFocusablePanel();
    focusTrap(dialog);
    const landed = clickFocus(text);
    expect(landed).toBe(dialog);
    expect(landed).not.toBe(panel);
    // No refocus to the first control, which is the jump that killed the drag.
    expect(document.activeElement).toBe(dialog);
  });

  it('makes the container focusable while trapping, even when it HAS controls', () => {
    focusTrap(dialog);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    // -1: reachable by click and focus(), never a Tab stop of its own.
    expect(dialog.tabIndex).toBe(-1);
  });

  it('still pulls focus back from a genuinely outside element', () => {
    inFocusablePanel();
    focusTrap(dialog);
    clickFocus(byId('behind'));
    expect(document.activeElement).toBe(byId('first'));
  });

  // @codex on #939: after a click on text, the CONTAINER is the active element.
  // `contains` is true of the node itself, so it read as "inside" and Shift+Tab
  // was left to the browser, which walked out to the page behind.
  it('Shift+Tab from the focused container cycles to the LAST control, not out of the dialog', () => {
    const { text } = inFocusablePanel();
    focusTrap(dialog);
    clickFocus(text);
    expect(document.activeElement).toBe(dialog);
    const ev = tabKey(true);
    dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('Tab from the focused container goes to the FIRST control', () => {
    const { text } = inFocusablePanel();
    focusTrap(dialog);
    clickFocus(text);
    const ev = tabKey();
    dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));
  });

  it('focusTrapWhen removes the tabindex it added when released…', () => {
    const action = focusTrapWhen(dialog, true);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    action.update(false);
    expect(dialog.hasAttribute('tabindex')).toBe(false);
  });

  it('…and never touches a tabindex the caller set', () => {
    dialog.setAttribute('tabindex', '0');
    const action = focusTrapWhen(dialog, true);
    action.update(false);
    expect(dialog.getAttribute('tabindex')).toBe('0');
  });
});

describe('focusTrap — initial-focus preference (#1599)', () => {
  // Both review seats on portal#1599 hit the same P2: SelectUser's Close
  // button precedes its search input in the DOM, so the trap's
  // first-tabbable landing put focus on Close — typing went nowhere and
  // Enter closed the picker. The remedy (their proposal): a dialog can mark
  // the wanted landing with `data-initial-focus`, and the trap — never a
  // child action, which corrupts the opener capture (#1305) — prefers it.
  // Only the LANDING changes; the Tab cycle keeps DOM order.

  it('focuses the control marked data-initial-focus over the first tabbable', () => {
    byId('mid').setAttribute('data-initial-focus', '');
    focusTrap(dialog);
    expect(document.activeElement).toBe(byId('mid'));
  });

  it('still captures the opener before moving focus to the marked control', () => {
    byId('mid').setAttribute('data-initial-focus', '');
    const trap = focusTrap(dialog);
    expect(document.activeElement).toBe(byId('mid')); // not the opener, and not #first
    trap.destroy();
    expect(document.activeElement).toBe(opener); // the real opener was captured first
  });

  it('ignores a marked control the tabbable filter would drop, falling back to the first tabbable', () => {
    // A disabled marked control must not be focused — the mark is a
    // preference among FOCUSABLE controls, not an override of focusability.
    byId('mid').setAttribute('data-initial-focus', '');
    byId('mid').setAttribute('disabled', '');
    focusTrap(dialog);
    expect(document.activeElement).toBe(byId('first'));
  });

  it('keeps the Tab cycle in DOM order: Tab from the last control reaches the first tabbable, not the marked one', () => {
    byId('mid').setAttribute('data-initial-focus', '');
    focusTrap(dialog);
    byId('last').focus();
    dialog.dispatchEvent(tabKey());
    expect(document.activeElement).toBe(byId('first'));
  });
});

describe('focusTrap — suspend/resume for a dialog stacked on top (#1582)', () => {
  it('a suspended trap does not pull focus back while the dialog above is open', () => {
    // The QA P2 RangeError: two live document-level focusin guards re-trigger
    // each other. The lower trap must stand down completely while the upper
    // dialog is open — this is the suspend() half; SelectNode's client test
    // pins the composed two-dialog behavior.
    const trap = focusTrap(dialog);
    trap.suspend();
    const behind = byId('behind');
    behind.focus();
    behind.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(behind);
  });

  it('resume() recaptures a focus that escaped to an outside element', () => {
    const trap = focusTrap(dialog);
    trap.suspend();
    byId('behind').focus();
    trap.resume();
    expect(document.activeElement).toBe(byId('first'));
  });

  it('resume() leaves a <body> focus to the host dialog — that hole is the host\'s to close (#1582 BLIND delta P2)', () => {
    // The body exemption is DELIBERATE and load-bearing: pulling focus here
    // would race the host dialog's own restoration, and a focus that lands
    // on <body> via element REMOVAL fires no focusin the guard could have
    // seen anyway. SelectNode pairs this trap with an effect that recaptures
    // a body focus itself plus a window-capture Escape fallback. Changing
    // the exemption breaks that division of labor — if body focus must be
    // pulled, change the host component too.
    const trap = focusTrap(dialog);
    trap.suspend();
    byId('first').blur();
    expect(document.activeElement).toBe(document.body);
    trap.resume();
    expect(document.activeElement).toBe(document.body);
  });
});
