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
 * Both forms are matched, deliberately: the rendered string is what a reader
 * types, and the raw value is what a reader PASTES from an API response or a
 * log line. `#819` and `819` both find the same row.
 */
/**
 * The row is typed STRUCTURALLY rather than as TanStack's `Row`. v9 changed
 * that type's generic arity (it takes the feature set as well as the data), and
 * the only thing this filter needs is `getValue` — so a structural parameter
 * both decouples us from that churn and is assignable wherever a `FilterFn` is
 * expected, since accepting a wider parameter type is safe.
 */
interface FilterableRow {
  getValue: (columnId: string) => unknown;
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
 * Build a `globalFilterFn` that matches the rendered text OR the raw value.
 *
 * Case-insensitive on both sides. An empty needle matches everything, which is
 * what an empty search box should do.
 */
export function makeGlobalFilterFn(fmt: ColumnFormatters) {
  return (row: FilterableRow, columnId: string, filterValue: unknown): boolean => {
    const needle = String(filterValue ?? '').toLowerCase();
    if (!needle) return true;

    const raw = row.getValue(columnId);
    if (searchableText(fmt, columnId, raw).toLowerCase().includes(needle)) return true;
    // The raw form too: an id or timestamp pasted from an API response should
    // still find its row even though the cell renders it differently.
    return raw === null || raw === undefined
      ? false
      : String(raw).toLowerCase().includes(needle);
  };
}
