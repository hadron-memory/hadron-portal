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

  // Prefer the first tabbable control; fall back to the container itself, made
  // programmatically focusable, so an empty dialog still takes focus off the
  // page behind it rather than leaving it there.
  const first = tabbable(container)[0];
  if (first) {
    first.focus();
  } else {
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    container.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
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

    // Focus having escaped the container at all (or sitting on the container
    // itself) means the next Tab must come back in, not continue outward.
    if (!(active instanceof HTMLElement) || !container.contains(active)) {
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
    const target = e.target;
    if (target instanceof HTMLElement && !container.contains(target)) {
      (tabbable(container)[0] ?? container).focus();
    }
  }
  document.addEventListener('focusin', onFocusIn);

  return {
    destroy() {
      container.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('focusin', onFocusIn);
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
