/**
 * #895 — the build heap report, and the preload that produces it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WARN_RATIO, heapReport, heapWarning } from './build-heap-report.mjs';

const MB = 1024 * 1024;

describe('heapReport', () => {
  it('states the peak against the limit', () => {
    const r = heapReport({ peakBytes: 2148 * MB, limitBytes: 4096 * MB });
    expect(r).toMatchObject({ peakMB: 2148, limitMB: 4096, percent: 52, warn: false });
    expect(r.line).toBe('build heap peak: 2148 MB of 4096 MB limit (52%)');
  });

  it('warns only PAST the threshold, not at it', () => {
    expect(heapReport({ peakBytes: 3072 * MB, limitBytes: 4096 * MB }).warn).toBe(false); // exactly 75%
    expect(heapReport({ peakBytes: 3073 * MB, limitBytes: 4096 * MB }).warn).toBe(true);
    expect(WARN_RATIO).toBe(0.75);
  });

  it('refuses a limit it cannot divide by, rather than printing NaN%', () => {
    expect(() => heapReport({ peakBytes: 1, limitBytes: 0 })).toThrow(/positive/);
  });
});

describe('heapWarning', () => {
  it('is a GitHub annotation over the threshold, and nothing under it', () => {
    expect(heapWarning(heapReport({ peakBytes: 1000 * MB, limitBytes: 4096 * MB }))).toBeNull();
    const w = heapWarning(heapReport({ peakBytes: 3500 * MB, limitBytes: 4096 * MB }))!;
    expect(w.startsWith('::warning title=Build heap near its limit (portal#895)::build heap peak: 3500 MB of 4096 MB')).toBe(true);
    expect(w).toContain('Over 75% of the limit');
  });
});

describe('build-heap-peak.mjs as a preload', () => {
  const preload = resolve(__dirname, 'build-heap-peak.mjs');

  it('reports the MAIN thread once — a worker thread loads the preload too, and stays silent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heap-peak-'));
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, '');
    // A FILE worker, as the build's tooling starts them: `--import` runs in a
    // file worker and its exit hook fires, but NOT in an `eval: true` worker —
    // an eval worker here left the guard untested (its mutant survived).
    const worker = join(dir, 'worker.js');
    writeFileSync(worker, 'const a = []; for (let i = 0; i < 1e5; i++) a.push({ i });');
    const code = `new (require('node:worker_threads').Worker)(${JSON.stringify(worker)});`;
    const res = spawnSync(process.execPath, ['--import', preload, '-e', code], {
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const lines = res.stdout.split('\n').filter((l) => l.startsWith('build heap peak:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^build heap peak: \d+ MB of \d+ MB limit \(\d+%\)$/);
    // A small script is far under 75% of any default limit.
    expect(res.stdout).not.toContain('::warning');
    expect(readFileSync(summary, 'utf8')).toBe(`**${lines[0]}**\n`);
  });
});
