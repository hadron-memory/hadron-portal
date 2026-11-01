/**
 * Focus management for a modal dialog, as a Svelte action.
 *
 * `aria-modal="true"` is a PROMISE to assistive technology, not a mechanism: it
 * tells a screen reader the content behind the dialog is inert, but the browser
 * still lets Tab walk straight out into the page underneath. Without this, a
 * keyboard user can tab past an open dialog and activate the very controls the
 * dialog is covering (PR #697 review, codex).
 *
 * Three jobs, all of which have to happen for the promise to hold:
 *   1. move focus INTO the dialog on open,
 *   2. keep Tab / Shift+Tab cycling within it,
 *   3. restore focus to whatever opened it on close.
 *
 * Usage — on the dialog's own container, which must be rendered inside an
 * `{#if open}` so the action's mount/destroy coincide with open/close:
 *
 *   <div role="dialog" aria-modal="true" use:focusTrap>…</div>
 *
 * Escape-to-close stays the caller's business: some dialogs need to confirm
 * before dismissing, so this action deliberately does not swallow that key.
 */

/** Tabbable descendants, in DOM order. */
const TABBABLE = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]',
].join(',');

function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.tabIndex < 0) return false;
    // A zero-size box is the reliable cross-browser "not rendered" test; it also
    // catches `display: none` ancestors, which a style check on the element
    // itself would miss.
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

/**
 * `focusTrap` for a container that stays MOUNTED while it opens and closes.
 *
 * `focusTrap` rides the action's mount/destroy, so it wants the dialog inside an
 * `{#if open}`. That is the wrong shape for a surface that is re-parented into
 * a modal rather than created as one — the maximised team chat, whose thread
 * holds an accumulated transcript, a scroll position and an unsent draft that a
 * remount would drop. This wrapper turns the trap on and off with a boolean
 * instead, engaging exactly the same three jobs on `true` and releasing them
 * (with the focus restore) on `false`.
 *
 *   <div role="dialog" aria-modal={open ? 'true' : undefined} use:focusTrapWhen={open}>
 */
export function focusTrapWhen(container: HTMLElement, active: boolean) {
  let trap: ReturnType<typeof focusTrap> | null = active ? focusTrap(container) : null;
  return {
    update(next: boolean) {
      if (next && !trap) trap = focusTrap(container);
      else if (!next && trap) {
        trap.destroy();
        trap = null;
      }
    },
    destroy() {
      trap?.destroy();
      trap = null;
    },
  };
}

export function focusTrap(container: HTMLElement) {
  // Capture the opener BEFORE moving focus, so it can be restored on close.
  // Guarded: `document.activeElement` is <body> when nothing was focused, and
  // focusing <body> on teardown would be a no-op that loses the user's place.
  const opener =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

  // #938: the container is itself focusable (tabindex -1: reachable by click
  // and by focus(), never by Tab) for as long as the trap holds. A mousedown on
  // non-interactive content focuses the nearest focusable ANCESTOR. Without
  // this that can be a focusable element OUTSIDE the dialog, such as the
  // maximised team chat's enclosing tab panel (`tabindex="0"`). The focusin
  // guard below then yanked focus back in, mid-mousedown, which cancels
  // Chrome's text-selection drag: no text in the dialog could be selected.
  // With the container focusable, the click lands inside and nothing moves.
  const addedTabindex = !container.hasAttribute('tabindex');
  if (addedTabindex) container.setAttribute('tabindex', '-1');

  // Prefer the first tabbable control; fall back to the container itself, so
  // an empty dialog still takes focus off the page behind it rather than
  // leaving it there.
  const first = tabbable(container)[0];
  if (first) {
    first.focus();
  } else {
    container.focus();
  }

  // A trap nested under another dialog must stand down while the upper one is
  // open (#1582 QA P2): two live document-level focusin guards each pull focus
  // into their own dialog, and since the upper dialog is a DOM sibling of the
  // lower one, they re-trigger each other until the stack overflows. The
  // suspended trap keeps its listeners (and its captured opener) and simply
  // stops guarding; `resume()` re-arms and pulls focus back if it escaped.
  let suspended = false;

  function onKeydown(e: KeyboardEvent) {
    if (suspended || e.key !== 'Tab') return;
    // Recompute every time: a dialog's tabbable set changes as it loads content,
    // reveals errors, or swaps a button for a confirm pair.
    const items = tabbable(container);
    if (items.length === 0) {
      // Nothing to cycle between — keep focus in the dialog rather than letting
      // Tab escape to the page behind it.
      e.preventDefault();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const active = document.activeElement;

    // Focus having escaped the container at all, or sitting on the container
    // itself, means the next Tab must come back in, not continue outward. The
    // container case is common since #938 (a click on its text focuses it),
    // and `contains` is true of the node itself, so it needs its own test:
    // without it Shift+Tab walked out to the page behind (@codex on #939).
    if (!(active instanceof HTMLElement) || active === container || !container.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? lastItem : firstItem).focus();
      return;
    }
    if (e.shiftKey && active === firstItem) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  }

  // Capture phase, so the trap runs before a child's own Tab handling.
  container.addEventListener('keydown', onKeydown, true);
  // Also catch focus that lands outside via a click or programmatic focus() —
  // keydown alone can't see those.
  function onFocusIn(e: FocusEvent) {
    if (suspended) return;
    const target = e.target;
    if (target instanceof HTMLElement && !container.contains(target)) {
      (tabbable(container)[0] ?? container).focus();
    }
  }
  document.addEventListener('focusin', onFocusIn);

  return {
    /** Stand down while a dialog stacked ON TOP of this one is open. */
    suspend() {
      suspended = true;
    },
    /** Re-arm after the dialog above closed; recapture focus if it escaped. */
    resume() {
      suspended = false;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || (!container.contains(active) && active !== document.body)) {
        (tabbable(container)[0] ?? container).focus();
      }
    },
    destroy() {
      container.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('focusin', onFocusIn);
      // A container that stays mounted (focusTrapWhen) goes back to what it
      // was; a caller's own tabindex is never touched.
      if (addedTabindex) container.removeAttribute('tabindex');
      // Restore only if focus is still inside the dialog (or nowhere). If the
      // user has already clicked elsewhere, yanking them back would be worse
      // than not restoring at all.
      const active = document.activeElement;
      const stillInside =
        !(active instanceof HTMLElement) || active === document.body || container.contains(active);
      if (opener && stillInside && opener.isConnected) opener.focus();
    },
  };
}
