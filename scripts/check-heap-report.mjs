/** #1932: Check heap pressure, separately from the production Build. */
import { heapReport } from './build-heap-report.mjs';

/** @param {{ peakBytes: number; limitBytes: number; maxRssKiB: number }} m */
export function checkHeapReport(m) {
  const { peakMB, limitMB, percent, warn } = heapReport(m);
  const rssMB = Math.round(m.maxRssKiB / 1024);
  const line = `check heap peak: ${peakMB} MB of ${limitMB} MB limit (${percent}%); process peak RSS: ${rssMB} MB`;
  const warning = warn
    ? `::warning title=Check heap near its limit (portal#1932)::${line}. Over 75% of the limit — investigate growth before raising it again.`
    : null;
  return { line, warning };
}
