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
    expect(report.line).toBe('check sampled heap peak: 3200 MB of 4096 MB limit (78%); process peak RSS: 3800 MB');
    expect(report.warning).toContain('::warning title=Check memory near its budget (portal#1932)::');
    expect(checkHeapReport({ peakBytes: 3072 * MB, limitBytes: 4096 * MB, maxRssKiB: 3000 * 1024 }).warning).toBeNull();
  });
  it('warns from kernel peak RSS even when sampled heap misses synchronous work', () => {
    const MB = 1024 * 1024;
    const report = checkHeapReport({ peakBytes: 100 * MB, limitBytes: 4096 * MB, maxRssKiB: 3500 * 1024 });
    expect(report.warning).toContain('process RSS exceeds 75%');
  });
  it('retains RSS pressure after synchronous allocation and GC before any timer can run', () => {
    const child = spawnSync(process.execPath, ['--max-old-space-size=64', '--expose-gc', '--import', resolve(__dirname, 'check-heap-peak.mjs'), '-e', 'let a = Array.from({length: 500000}, (_, i) => ({i,a:i,b:i,c:i,d:i,e:i})); a = null; global.gc();'], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    const sample = child.stdout.match(/sampled heap peak: (\d+) MB of (\d+) MB limit/)!;
    expect(sample).not.toBeNull();
    expect(Number(sample[1])).toBeLessThan(Number(sample[2]) * 0.75);
    expect(child.stdout).toContain('::warning title=Check memory near its budget');
  });
  it('reports once, writes the CI summary, and preserves failed checker exit codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-heap-'));
    try {
      const summary = join(dir, 'summary.md');
      const worker = join(dir, 'worker.cjs');
      writeFileSync(worker, 'const a = Array.from({length: 10000}, (_, i) => ({i}));');
      const child = spawnSync(process.execPath, ['--import', resolve(__dirname, 'check-heap-peak.mjs'), '-e', `new (require('node:worker_threads').Worker)(${JSON.stringify(worker)}).on('exit', () => { process.exitCode = 7; });`], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
      expect(child.status).toBe(7);
      const lines = child.stdout.split('\n').filter(line => line.startsWith('check sampled heap peak:'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^check sampled heap peak: \d+ MB of \d+ MB limit \(\d+%\); process peak RSS: \d+ MB$/);
      expect(readFileSync(summary, 'utf8')).toBe(`**${lines[0]}**\n`);
      const unwritable = spawnSync(process.execPath, ['--import', resolve(__dirname, 'check-heap-peak.mjs'), '-e', 'process.exitCode = 3;'], { env: { ...process.env, GITHUB_STEP_SUMMARY: dir }, encoding: 'utf8' });
      expect(unwritable.status).toBe(3);
      expect(unwritable.stdout).toContain('check sampled heap peak:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
