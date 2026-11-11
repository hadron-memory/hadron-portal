/** #1932: Check heap pressure, separately from the production Build. */
import { heapReport } from './build-heap-report.mjs';

/** @param {{ peakBytes: number; limitBytes: number; maxRssKiB: number }} m */
export function checkHeapReport(m) {
  const { peakMB, limitMB, percent, warn } = heapReport(m);
  const rssMB = Math.round(m.maxRssKiB / 1024);
  const line = `check sampled heap peak: ${peakMB} MB of ${limitMB} MB limit (${percent}%); process peak RSS: ${rssMB} MB`;
  // RSS is kernel-maintained even while synchronous checking blocks the sampler.
  // Compare it conservatively with the heap budget; native allocations can alert early.
  const warning = (warn || m.maxRssKiB * 1024 > m.limitBytes * 0.75)
    ? `::warning title=Check memory near its budget (portal#1932)::${line}. Heap or process RSS exceeds 75% of the heap budget (RSS includes native memory) — investigate growth before raising it again.`
    : null;
  return { line, warning };
}
