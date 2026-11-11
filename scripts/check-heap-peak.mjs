/**
 * #1932: preload only the svelte-check process, not sync, pnpm or Build.
 * Main-thread heapUsed is sampled every 200 ms; synchronous checking can block
 * sampling for its entire duration, not just brief peaks. The sampled value is
 * a lower bound, NOT the actual heap high-water mark. Peak RSS is maintained
 * by the kernel and supplies an independent warning when sampling is blocked.
 * resourceUsage().maxRSS is the process high-water RSS, including native memory;
 * it is not the V8 heap ceiling. Neither measurement is runner-wide memory.
 * Reports on normal exit, including failed diagnostics. A fatal V8 abort may
 * bypass exit hooks; its raw OOM/exit status remains the evidence in that case.
 */
import { appendFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { isMainThread } from 'node:worker_threads';
import { checkHeapReport } from './check-heap-report.mjs';

if (isMainThread) {
  let peakBytes = 0;
  const sample = () => { peakBytes = Math.max(peakBytes, process.memoryUsage().heapUsed); };
  sample();
  setInterval(sample, 200).unref();
  process.on('exit', () => {
    sample();
    const report = checkHeapReport({
      peakBytes,
      limitBytes: getHeapStatistics().heap_size_limit,
      maxRssKiB: process.resourceUsage().maxRSS,
    });
    console.log(report.line);
    if (report.warning) console.log(report.warning);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${report.line}**\n`);
      } catch {
        // Observability must not alter the checker's diagnostic/exit result.
      }
    }
  });
}
