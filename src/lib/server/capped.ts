/**
 * A window read with no continuation came back FULL, so more rows may exist.
 * Exactly `limit` rows is ambiguous (there may be none behind it), so the cue
 * errs toward saying "more may exist" rather than implying completeness.
 */
export function isCapped(rowCount: number, limit: number): boolean {
  return rowCount >= limit;
}
