/**
 * #1085 — y-axis tick labels for UsageActivityChart that always fit.
 *
 * The chart used a fixed 30px left pad with the raw number right-aligned at
 * x=25, so a fifth digit fell off the SVG (`10000` read `0000`). Two levers,
 * together: labels are compact (`10K`, `2.5M`), which bounds their width at
 * any volume, and the pad is sized from the widest label, so whatever the
 * labels are, they fit.
 *
 * The width is ESTIMATED from the label's characters rather than measured
 * with getBBox: the chart renders on the server too, and an estimate gives the
 * same pad there and in the browser, with no layout shift after hydration.
 * The estimate is deliberately generous: wider than each glyph it covers.
 */

// A fixed locale, like the portal's other number and date formatting: the
// server render and the hydrated client must produce the same label.
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A y tick label: `10K`, `2.5M`; small values read as themselves. */
export function formatTick(value: number): string {
  return compact.format(value);
}

/**
 * Estimated px width of a label at the `.viz-tick` size (10px). Measured in
 * Chromium: a digit is 6.36px and `M`, the widest suffix, about 8.6px.
 */
function labelWidth(label: string): number {
  let w = 0;
  for (const ch of label) w += ch === '.' ? 3 : /\d/.test(ch) ? 6.5 : 9;
  return w;
}

/** Gap between a label's right edge and the plot's left edge. */
export const TICK_GAP = 5;
/** The old fixed pad: short labels keep exactly the layout they had. */
const MIN_PAD_L = 30;

/** The plot's left pad: room for the widest label, its gap, and a 1px margin. */
export function tickPadLeft(labels: string[]): number {
  const widest = Math.max(0, ...labels.map(labelWidth));
  return Math.max(MIN_PAD_L, Math.ceil(widest) + TICK_GAP + 1);
}
