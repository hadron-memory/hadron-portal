/**
 * #895 — preload that records the build's main-thread heap peak.
 *
 *   NODE_OPTIONS="--import ./scripts/build-heap-peak.mjs" pnpm build
 *
 * CI's Build step loads it. On exit it prints one line, appends it to the job
 * summary when `GITHUB_STEP_SUMMARY` is set, and emits a `::warning::` when the
 * peak passes `WARN_RATIO` of the limit (see build-heap-report.mjs for the
 * measurements behind it).
 *
 * Main thread only: `--import` also runs in every worker thread, and each
 * worker has its own small heap — the main thread is the one that ran out.
 * Sampled every 200 ms, so a spike between samples can be missed; the report is
 * a trend signal, not a guarantee.
 */
import { appendFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { isMainThread } from 'node:worker_threads';
import { heapReport, heapWarning } from './build-heap-report.mjs';

if (isMainThread) {
  let peak = 0;
  const sample = () => {
    const used = process.memoryUsage().heapUsed;
    if (used > peak) peak = used;
  };
  setInterval(sample, 200).unref();

  process.on('exit', () => {
    sample();
    const r = heapReport({ peakBytes: peak, limitBytes: getHeapStatistics().heap_size_limit });
    console.log(r.line);
    const warning = heapWarning(r);
    if (warning) console.log(warning);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${r.line}**${r.warn ? ' ⚠️' : ''}\n`);
      } catch {
        // A summary that cannot be written must not fail a build that succeeded.
      }
    }
  });
}
