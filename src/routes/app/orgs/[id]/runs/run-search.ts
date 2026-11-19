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
 * the rendered string is the only thing there is. Stated rather than left as
 * an apparent omission.
 *
 * `status` joins them for #1766: the chip renders `runStatusLabel` — `Unknown:
 * {raw}` for a value a newer server added — while the accessor keeps the raw
 * enum name, because the status-filter buttons match known-set membership
 * against it. The label is the text on screen, so it belongs in the search
 * mirror; reusing the render site's own function so the two cannot drift.
 */
import { runStatusLabel } from '$lib/flow/runs';

/** The subset of a run row this needs. */
export interface RunSearchFields {
  /** The raw status the accessor keeps (#1766: may be an unknown enum name). */
  status: string;
  /** The formatted time the cell shows. */
  started: string;
  /** The wire timestamp the epoch-millis accessor discarded. */
  startedRaw: string;
  /** The formatted elapsed time the cell shows. */
  duration: string;
}

export function runSearchExtras() {
  return {
    status: (row: RunSearchFields) => runStatusLabel(row.status),
    started: (row: RunSearchFields) => `${row.started} ${row.startedRaw}`,
    duration: (row: RunSearchFields) => row.duration,
  };
}
