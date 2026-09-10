/**
 * #820 — the searchable text an asset row's ACCESSORS threw away.
 *
 * Extracted rather than inlined in the grid options, following
 * `sessionSearchExtras` / `worklogSearchExtras` from #819: an extras map buried
 * in a component is only checkable by rendering that component, and what it
 * asserts — "a reader can find this row by what they have in their clipboard" —
 * is worth a test of its own.
 */

/** The subset of an asset row this needs. */
export interface AssetSearchFields {
  /** The formatted date the cell shows. */
  uploaded: string;
  /** The wire timestamp, which the epoch-millis accessor discarded. */
  uploadedAt: string;
}

/**
 * BOTH forms, and the second is the one #829's review caught missing.
 *
 * The `uploaded` column accessors epoch millis so it sorts by instant, and the
 * cell renders a formatted date — so a reader has two plausible things in their
 * clipboard and NEITHER is the accessor value: the date they can see, or the
 * ISO timestamp they pasted out of an API response or a log line. The row now
 * carries the wire value precisely so the second one works.
 */
export function assetSearchExtras() {
  return {
    uploaded: (row: AssetSearchFields) => `${row.uploaded} ${row.uploadedAt}`,
  };
}
