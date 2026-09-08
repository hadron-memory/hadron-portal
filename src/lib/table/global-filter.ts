/**
 * A global filter that searches what the reader can SEE.
 *
 * TanStack's built-in `includesString` stringifies the ACCESSOR value, and two
 * of this repo's own column conventions guarantee that is not what the cell
 * shows:
 *
 *   - a date column's accessor returns epoch millis, so the column sorts
 *     chronologically rather than lexicographically
 *     (`hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant`);
 *   - numeric accessors keep counts and ids sorting numerically
 *     (`hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions`).
 *
 * So a reader who types the date they are looking at — `9/6/2026` — matches
 * nothing, because the filter is comparing against `1788681600000`. Measured,
 * not inferred: `includesString` returns false for `9/6/2026` and true for
 * `178868`. The searchable value was the epoch digits, which nobody types.
 *
 * The same convention page also says accessors should return "the rendered i18n
 * string so sorting and the global filter match the screen". Those two rules
 * genuinely collide on a date column — one wants a number, the other wants the
 * string — and this resolves the collision at the FILTER rather than by
 * sacrificing either sort order or searchability.
 *
 * THREE forms are matched, and the third is the one that is easy to get wrong:
 *
 *   - the RENDERED string, which is what a reader types from the screen;
 *   - the ACCESSOR value, which is what `row.getValue` returns;
 *   - optional EXTRA text read from the original row.
 *
 * The third exists because the accessor is not the wire value. On a date column
 * the accessor has already replaced the ISO timestamp with epoch millis, so a
 * reader pasting `2026-09-06T08:00:00.000Z` from an API response or a log line
 * matches neither the rendering nor the number (@codex on #819). An earlier
 * version of this comment claimed the raw-value fallback covered exactly that
 * case; it did not, because `getValue` never sees the wire string.
 */
/**
 * The row is typed STRUCTURALLY rather than as TanStack's `Row`. v9 changed
 * that type's generic arity (it takes the feature set as well as the data), and
 * the only thing this filter needs is `getValue` — so a structural parameter
 * both decouples us from that churn and is assignable wherever a `FilterFn` is
 * expected, since accepting a wider parameter type is safe.
 */
interface FilterableRow<T> {
  getValue: (columnId: string) => unknown;
  /** The source row, for searchable text the accessor has already discarded. */
  original: T;
}

/** Per-column renderers, keyed by column id — the same map a cell falls back to. */
export type ColumnFormatters = Record<string, (value: unknown) => string>;

/**
 * What a column's value looks like on screen.
 *
 * Exported so the cell fallback and the filter share one definition of
 * "rendered". Two copies of that is how a column becomes searchable by a string
 * it no longer displays.
 */
export function searchableText(
  fmt: ColumnFormatters,
  columnId: string,
  value: unknown,
): string {
  const format = fmt[columnId];
  if (format) return format(value);
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Extra searchable text per column, read from the ORIGINAL row.
 *
 * For a column whose accessor is lossy — a date accessor returning epoch millis
 * — this is where the wire value goes, so a pasted ISO timestamp still finds
 * its row. Return null when there is nothing to add.
 */
export type ColumnSearchExtras<T> = Record<string, (row: T) => string | null | undefined>;

/**
 * Build a `globalFilterFn` matching the rendered text, the accessor value, or
 * any extra searchable text the accessor discarded.
 *
 * Case-insensitive throughout. An empty needle matches everything, which is
 * what an empty search box should do.
 */
export function makeGlobalFilterFn<T>(fmt: ColumnFormatters, extras: ColumnSearchExtras<T> = {}) {
  return (row: FilterableRow<T>, columnId: string, filterValue: unknown): boolean => {
    const needle = String(filterValue ?? '').toLowerCase();
    if (!needle) return true;

    const raw = row.getValue(columnId);
    if (searchableText(fmt, columnId, raw).toLowerCase().includes(needle)) return true;

    // The accessor value: an id typed as a bare number should find its row even
    // though the cell renders it as `#819`.
    if (raw !== null && raw !== undefined && String(raw).toLowerCase().includes(needle)) {
      return true;
    }

    // Whatever the accessor threw away — for a date column, the wire timestamp.
    const extra = extras[columnId]?.(row.original);
    return extra ? extra.toLowerCase().includes(needle) : false;
  };
}
