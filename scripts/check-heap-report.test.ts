import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHeapReport } from './check-heap-report.mjs';

describe('Check memory visibility (#1932)', () => {
  it('distinguishes heap and RSS, warning only beyond 75% of the heap ceiling', () => {
    const MB = 1024 * 1024;
    const report = checkHeapReport({ peakBytes: 3200 * MB, limitBytes: 4096 * MB, maxRssKiB: 3800 * 1024 });
    expect(report.line).toBe('check heap peak: 3200 MB of 4096 MB limit (78%); process peak RSS: 3800 MB');
    expect(report.warning).toContain('::warning title=Check heap near its limit (portal#1932)::');
    expect(checkHeapReport({ peakBytes: 3072 * MB, limitBytes: 4096 * MB, maxRssKiB: 3500 * 1024 }).warning).toBeNull();
  });
  it('reports once, writes the CI summary, and preserves failed checker exit codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-heap-'));
    try {
      const summary = join(dir, 'summary.md');
      const worker = join(dir, 'worker.cjs');
      writeFileSync(worker, 'const a = Array.from({length: 10000}, (_, i) => ({i}));');
      const child = spawnSync(process.execPath, ['--import', resolve(__dirname, 'check-heap-peak.mjs'), '-e', `new (require('node:worker_threads').Worker)(${JSON.stringify(worker)}).on('exit', () => { process.exitCode = 7; });`], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
      expect(child.status).toBe(7);
      const lines = child.stdout.split('\n').filter(line => line.startsWith('check heap peak:'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^check heap peak: \d+ MB of \d+ MB limit \(\d+%\); process peak RSS: \d+ MB$/);
      expect(readFileSync(summary, 'utf8')).toBe(`**${lines[0]}**\n`);
      const unwritable = spawnSync(process.execPath, ['--import', resolve(__dirname, 'check-heap-peak.mjs'), '-e', 'process.exitCode = 3;'], { env: { ...process.env, GITHUB_STEP_SUMMARY: dir }, encoding: 'utf8' });
      expect(unwritable.status).toBe(3);
      expect(unwritable.stdout).toContain('check heap peak:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
