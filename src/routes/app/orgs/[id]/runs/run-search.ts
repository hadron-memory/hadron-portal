/**
 * #820 — the searchable text a run row's ACCESSORS threw away.
 *
 * Same shape and same reason as `assetSearchExtras`: `started` accessors epoch
 * millis so the column sorts chronologically, the cell renders a formatted
 * string, and the reader's clipboard holds one or the other — most often the
 * ISO timestamp out of a log line, which is exactly the case the accessor
 * cannot answer (#829 review, @copilot).
 *
 * `duration` has no wire form to add: it is computed from two timestamps, so
 * the rendered string is the only thing there is to match. Stated rather than
 * left as an apparent omission.
 */

/** The subset of a run row this needs. */
export interface RunSearchFields {
  /** The formatted time the cell shows. */
  started: string;
  /** The wire timestamp the epoch-millis accessor discarded. */
  startedRaw: string;
  /** The formatted elapsed time the cell shows. */
  duration: string;
}

export function runSearchExtras() {
  return {
    started: (row: RunSearchFields) => `${row.started} ${row.startedRaw}`,
    duration: (row: RunSearchFields) => row.duration,
  };
}
