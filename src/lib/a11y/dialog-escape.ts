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
 */
export function dialogEscapeFallback(el: HTMLElement, options: DialogEscapeOptions) {
  // Held by reference, swapped on update — a spread would snapshot every
  // reactive getter once and the fallback would go stale
  // (review:preserve-getters-when-wrapping-options).
  let current = options;
  function onKeydown(event: KeyboardEvent) {
    if (!escapeIsOurs(event)) return;
    if (current.suppressed?.()) return;
    if (event.target instanceof Node && el.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    current.close();
  }
  window.addEventListener('keydown', onKeydown, true);
  return {
    update(next: DialogEscapeOptions) {
      current = next;
    },
    destroy() {
      window.removeEventListener('keydown', onKeydown, true);
    },
  };
}
