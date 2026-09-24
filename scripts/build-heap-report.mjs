/**
 * #895 — what the build's heap peak report says, and when it warns. Pure, so it
 * is tested without a build; `build-heap-peak.mjs` is the preload that samples
 * the heap and hands the numbers here.
 *
 * ## Why the build needs watching (measured 2026-09-24, main 5fe8063, Node 22)
 *
 * SvelteKit runs the client build INSIDE the SSR build, and adapter-node's
 * Rollup re-bundle inside that, all on one main-thread heap: ~930 MB after the
 * SSR build, ~2,020 MB with the client build, ~2,150 MB during the adapter.
 * Capped with --max-old-space-size, the build fails at 2,000 MB (in the
 * adapter, as CI did) and passes at 2,080 MB. CI's default limit is ~2,080 MB,
 * so it ran with almost no headroom, and runner noise decided each run.
 *
 * The `build` script now grants 4,096 MB. Headroom alone would hide the next
 * doubling until it broke again, so CI reports the peak on every run and warns
 * well before the limit.
 *
 * The peak is heap USED as sampled, garbage included: with a loose limit V8
 * collects lazily, so it reads above what the build strictly needs. It is a
 * conservative upper bound — the right side to err on for an early warning.
 */

/** Warn when the sampled peak passes this share of the heap limit. */
export const WARN_RATIO = 0.75;

const MB = 1024 * 1024;

/**
 * @param {{ peakBytes: number; limitBytes: number; warnRatio?: number }} m
 * @returns {{ peakMB: number; limitMB: number; percent: number; warn: boolean; line: string }}
 */
export function heapReport({ peakBytes, limitBytes, warnRatio = WARN_RATIO }) {
  if (!(limitBytes > 0)) throw new Error(`heap limit must be positive, got ${limitBytes}`);
  const peakMB = Math.round(peakBytes / MB);
  const limitMB = Math.round(limitBytes / MB);
  const percent = Math.round((peakBytes / limitBytes) * 100);
  const warn = peakBytes > limitBytes * warnRatio;
  const line = `build heap peak: ${peakMB} MB of ${limitMB} MB limit (${percent}%)`;
  return { peakMB, limitMB, percent, warn, line };
}

/**
 * The GitHub Actions annotation for a report over the threshold, or null.
 * An annotation, not a failure: the build still succeeded, and the point is to
 * see growth BEFORE it breaks.
 *
 * @param {ReturnType<typeof heapReport>} r
 */
export function heapWarning(r, warnRatio = WARN_RATIO) {
  if (!r.warn) return null;
  return (
    `::warning title=Build heap near its limit (portal#895)::${r.line}. ` +
    `Over ${Math.round(warnRatio * 100)}% of the limit — find what grew before raising it again.`
  );
}
