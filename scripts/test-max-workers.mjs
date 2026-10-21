/**
 * Hugo's #28704 — cap vitest's worker pool from the host, so several full
 * suites running at once on a shared box (orca1, the mm container) don't
 * exhaust its memory
 * (hrn:node:hadronmemory.com:hadron-dev-team-hugo:findings:orca1-memory-exhaustion-parallel-full-suites-2026-10-21).
 *
 * HADRON_TEST_MAX_WORKERS, when it is a positive integer, becomes vitest's
 * `maxWorkers`. Unset or empty leaves vitest's own default. Anything else is
 * ignored too, but said on stderr, so a typo doesn't pass for a cap.
 *
 * @param {string | undefined} raw
 * @param {(message: string) => void} [warn]
 * @returns {number | undefined}
 */
export function testMaxWorkers(raw, warn = (m) => console.warn(m)) {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  warn(`HADRON_TEST_MAX_WORKERS=${JSON.stringify(raw)} is not a positive integer; using vitest's default workers.`);
  return undefined;
}
