/**
 * The Select-family dialog Escape pattern (#1582/#1584,
 * hrn:node:hadronmemory.com:hadron-portal:findings:dialog-escape-consumed-at-its-layer):
 * a dialog consumes Escape at its OWN DOM layer, and a window handler survives
 * only as the fallback for a focus that never entered the dialog.
 *
 * Why not just `<svelte:window onkeydown>`: window listeners fire in
 * REGISTRATION ORDER, and a host that mounted earlier (an edit panel, another
 * picker) sees the same keypress before the dialog's own handler runs — one
 * Escape closes several layers at once (#1582 BLIND P2-7, QA P2). A bubble
 * listener on window also cannot be stopped from below. Only the CAPTURE
 * phase runs before every bubble listener on window, so only it can shield a
 * host from a keypress the dialog owns.
 *
 * The same contract serves any INNER floating layer inside a dialog (a
 * saved-view caret menu, a Columns dropdown), with BOTH halves required
 * (#1587 review, LOCAL + BLIND P2): `consumeEscapeAtDialog` on the layer's
 * own element claims the key for a focus INSIDE it — the menu's element is
 * deeper in the tree, so its bubble handler runs first — and the layer must
 * ALSO arm `dialogEscapeFallback` while open. Element consumption alone
 * covers only that in-layer focus: an opener's focus stays on the control
 * that launched the layer (a caret button, a summary) or moves elsewhere in
 * the dialog, and then the DIALOG's element consumer would take the key and
 * close the whole picker. The armed stack resolves it: the layer opened
 * last is the topmost, so its capture fallback claims the key wherever the
 * target sits — launcher, another control in the dialog, or <body> — before
 * any dialog element handler can bubble. Arm the fallback on markup that
 * exists only while the layer is open (the `{#if open}` block rides the
 * action's mount/destroy), never on an always-mounted element: an armed
 * token from a CLOSED layer would orphan body-focus keys (every fallback
 * above it declines, and so does it).
 *
 * The two guards (#1582 delta P3 (b), folded here once — not per picker): an
 * Escape whose event is already `defaultPrevented` was consumed by someone
 * else (another dialog layer that took the key first), and one with
 * `isComposing` true is cancelling an IME composition, not the dialog.
 */

/** Options are read at EVENT time; getters stay live (never spread this object). */
export interface DialogEscapeOptions {
  /** Close the dialog. */
  close: () => void;
  /** True when the key is not this dialog's to take (a nested dialog owns it). */
  suppressed?: () => boolean;
}

/** The shared decision: is this Escape ours to take? */
export function escapeIsOurs(event: KeyboardEvent): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && !event.isComposing;
}

/**
 * The dialog layer's own consumption — put this in the `onkeydown` of the
 * `role="dialog"` element. `stopPropagation` keeps the keypress from ever
 * reaching window, so layers above (which registered their listeners first
 * and cannot be stopped from below) never close with us.
 */
export function consumeEscapeAtDialog(event: KeyboardEvent, options: DialogEscapeOptions): void {
  if (!escapeIsOurs(event)) return;
  if (options.suppressed?.()) return;
  // Consuming an inner layer must also cancel the native close request on an
  // outer <dialog>. Repeated Escape can make its cancel event non-cancelable.
  event.preventDefault();
  event.stopPropagation();
  options.close();
}

/**
 * The window fallback, as a Svelte action on the dialog element. Use it on
 * the same element as the dialog-level `onkeydown`; the action's mount and
 * destroy ride the `{#if open}` block, so the listener lives exactly while
 * the dialog does.
 *
 * Listens in CAPTURE phase, and takes the key only when its target never
 * entered this dialog — a focus inside is the dialog-level handler's job.
 * On take it consumes the event completely, so an earlier-registered host
 * listener never fires either.
 *
 * Last armed wins (#1584): capture listeners on window also fire in
 * registration order, so with two STACKED fallback-armed dialogs and focus
 * stranded on <body>, the OUTER dialog's fallback would run first and close
 * the host out from under the picker still open above it. Each armed
 * fallback registers itself here; only the last-armed — the topmost layer,
 * because a dialog above always opens after the one below — may take the
 * key. `suppressed()` stays as a second belt for nests the caller knows
 * about (SelectNode's memory picker) and for overlays that don't use the
 * helper at all.
 */
const armed: object[] = [];

export function dialogEscapeFallback(el: HTMLElement, options: DialogEscapeOptions) {
  // Held by reference, swapped on update — a spread would snapshot every
  // reactive getter once and the fallback would go stale
  // (hrn:node:hadronmemory.com:hadron-portal:review:preserve-getters-when-wrapping-options).
  let current = options;
  const token = {};
  function onKeydown(event: KeyboardEvent) {
    if (!escapeIsOurs(event)) return;
    if (armed[armed.length - 1] !== token) return; // a layer above us is armed
    if (current.suppressed?.()) return;
    if (event.target instanceof Node && el.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    current.close();
  }
  armed.push(token);
  window.addEventListener('keydown', onKeydown, true);
  return {
    update(next: DialogEscapeOptions) {
      current = next;
    },
    destroy() {
      const at = armed.indexOf(token);
      if (at !== -1) armed.splice(at, 1);
      window.removeEventListener('keydown', onKeydown, true);
    },
  };
}
