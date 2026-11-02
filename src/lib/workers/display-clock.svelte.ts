/**
 * portal#1495 P3 — a page's display clock for ages.
 *
 * The loader returns one `terminalNow` so SSR and the first client render
 * agree (no hydration mismatch); that instant is a SEED, not a freeze — a
 * dashboard left open showed "checked 2 min. ago" for hours. After mount, a
 * browser-only interval advances the clock every 30 s by the offset recorded
 * at start (`seed − Date.now()`), so ages stay anchored to the server-relative
 * baseline instead of jumping to the browser's own clock.
 *
 * A tick recomputes DISPLAYED TEXT and nothing else: no fetch, `invalidate`
 * or reload, no recomputation of stored terminal state, reason, darkness or
 * authority (issue gate 6568261816; anything server-driven is new scope).
 * `start()` must be called from an `$effect` (which never runs during SSR);
 * the interval is cleared on destroy. One clock per page.
 */
import { pageClock } from './terminal';

export const DISPLAY_CLOCK_INTERVAL_MS = 30_000;

export function createDisplayClock(loaderIso: string | null | undefined) {
  let now = $state(pageClock(loaderIso));
  let offsetMs = 0;
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    get now() {
      return now;
    },
    /** Browser-only (call from `$effect`): record the offset, tick every 30 s. */
    start() {
      if (handle !== null) return;
      offsetMs = now - Date.now();
      handle = setInterval(() => {
        now = Date.now() + offsetMs;
      }, DISPLAY_CLOCK_INTERVAL_MS);
    },
    /** Clear the interval; safe to call when never started. */
    stop() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}

export type DisplayClock = ReturnType<typeof createDisplayClock>;
