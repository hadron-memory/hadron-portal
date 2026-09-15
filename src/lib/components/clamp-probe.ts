import { tick } from 'svelte';
import { bodyOverflows } from './team-chat-thread';

/**
 * Does a height-clamped element hide anything? A Svelte action that MEASURES
 * the answer and reports it, for the team chat's per-message "Show more".
 *
 * Measured rather than guessed from the text: a 400-character message with a
 * table can overflow the clamp while a 2,000-character one of short lines fits.
 * The clamp itself is CSS (a `max-height` the caller applies while `clamped`);
 * this action only decides whether to OFFER the control.
 *
 * Kept out of the component (a plain module over a DOM node) so its lifecycle
 * — observe, re-measure, disconnect — is testable in jsdom without mounting the
 * thread, which needs a SvelteKit form runtime the client lane does not have.
 *
 * When it measures, and why only then:
 *   - at mount, if the body is already `ready` (a page prepended by scroll-up,
 *     whose markdown is rendered before the element exists). Synchronous, so
 *     the control lands in the same flush as the prepend and the #793 scroll
 *     anchor measures a height that already includes it;
 *   - when `ready` flips (the first render, whose markdown arrives only after
 *     mount) and when `clamped` flips back on (a collapse) — both after a
 *     `tick()`, so the DOM the measurement reads is the DOM the flag describes.
 *     Measuring a collapse synchronously reads the still-expanded box, reports
 *     "fits", and withdraws the control from a body about to be clamped;
 *   - on every resize the observer sees, which is what catches images and
 *     late-loading content.
 * Never while EXPANDED: an open body's scrollHeight equals its clientHeight by
 * construction, and recording that as "does not overflow" would withdraw the
 * "Show less" control mid-click.
 *
 * `update` is otherwise a no-op. A `use:` param written as an object literal is
 * rebuilt on every re-render of the row, so measuring on every `update` would
 * force a layout per message per render.
 */
export interface ClampProbeParams {
  /** The clamp is applied: the CSS max-height is in force. */
  clamped: boolean;
  /** The content the clamp applies to is in the DOM. */
  ready: boolean;
  /** Called with the current answer whenever it CHANGES. */
  onOverflow: (overflows: boolean) => void;
}

export function clampProbe(el: HTMLElement, params: ClampProbeParams) {
  let current = params;
  let reported: boolean | null = null;

  const measure = () => {
    if (!current.clamped || !current.ready) return;
    const over = bodyOverflows(el.scrollHeight, el.clientHeight);
    if (over === reported) return;
    reported = over;
    current.onOverflow(over);
  };
  const measureAfterFlush = () => void tick().then(measure);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  ro?.observe(el);
  measure();

  return {
    update(next: ClampProbeParams) {
      const prev = current;
      current = next;
      if ((next.ready && !prev.ready) || (next.clamped && !prev.clamped)) measureAfterFlush();
    },
    destroy() {
      ro?.disconnect();
    },
  };
}
