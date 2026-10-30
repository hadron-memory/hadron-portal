// Refs #1381, Slice 1. Production-compiled real TreeView, synthetic cached data.
// DISPLAY must point at an available display (Xvfb is explicitly reported).
// node scripts/diagnostics/tree-entry/run.mjs /absolute/output/directory
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
const sourceStatus = git('status', '--porcelain');
assert.equal(sourceStatus, '', 'Commit measurement sources before running the diagnostic');
assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'Pass an absolute scratch output directory outside the checkout');
const output = path.resolve(process.argv[2]);
assert.ok(!output.startsWith(root + path.sep), 'Keep traces and build output outside the checkout');
assert.notEqual(output, root);
assert.notEqual(output, path.parse(output).root);
await mkdir(output, { recursive: true });
const dist = path.join(output, 'dist');
await build({ root: fixture, configFile: false, plugins: [svelte({ configFile: false, compilerOptions: { dev: false } })],
  resolve: { alias: { $lib: path.join(root, 'src/lib'), '$app/stores': path.join(root, 'src/lib/test/stubs/app-stores.ts') } },
  build: { outDir: dist, emptyOutDir: true, minify: true } });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(filename);
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const runs = [];
const traceSlices = [];
const scenarios = [
  { label: 'small', size: 3292, roots: 50 },
  { label: 'large', size: 32920, roots: 500 },
  { label: 'compact', size: 32920, roots: 1 },
  { label: 'seeded', size: 32920, roots: 0 },
];
try {
  browser = await chromium.launch({ headless: false, args: ['--disable-extensions'] });
  for (const { label, size, roots } of scenarios) {
    // One warm-up and five measured fresh-page runs per scale; same browser.
    for (let run = 0; run <= 5; run++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => typeof window.prepareTree === 'function');
      const prepared = await page.evaluate(({ size, roots }) => window.prepareTree(size, roots), { size, roots });
      assert.equal(prepared.inputNodes, size);
      await page.bringToFront();
      const state = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() }));
      assert.deepEqual(state, { visibility: 'visible', focus: true });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await cdp.send('Runtime.getHeapUsage');
      await page.evaluate(() => {
        window.longTasks = [];
        window.observer = new PerformanceObserver((list) => window.longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration }))));
        window.observer.observe({ type: 'longtask', buffered: false });
      });
      if (run) await cdp.send('Tracing.start', { categories: 'devtools.timeline,toplevel,v8,blink.user_timing', transferMode: 'ReturnAsStream' });
      await page.getByRole('button', { name: 'Enter Tree' }).click();
      await page.waitForSelector('[data-done="true"]');
      await page.waitForTimeout(100);
      const measured = await page.evaluate(() => {
        const start = performance.getEntriesByName('tree-entry-start')[0].startTime;
        const end = performance.getEntriesByName('tree-entry-end')[0].startTime;
        const tasks = window.longTasks.filter((t) => t.start < end && t.start + t.duration > start);
        window.observer.disconnect();
        return { entryMs: end - start, largestTaskMs: Math.max(0, ...tasks.map((t) => t.duration)),
          totalBlockingMs: tasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0), longTasks: tasks,
          rows: document.querySelectorAll('.tree-row').length, elements: document.querySelectorAll('*').length,
          visibility: document.visibilityState, focus: document.hasFocus() };
      });
      assert.equal(measured.rows, prepared.expectedRows);
      assert.equal(measured.visibility, 'visible');
      assert.equal(measured.focus, true);
      const after = await cdp.send('Runtime.getHeapUsage');
      await cdp.send('HeapProfiler.collectGarbage');
      const retained = await cdp.send('Runtime.getHeapUsage');
      if (run) {
        const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const { stream } = await complete;
        let trace = '';
        while (true) { const chunk = await cdp.send('IO.read', { handle: stream }); trace += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data; if (chunk.eof) break; }
        await cdp.send('IO.close', { handle: stream });
        const traceName = `trace-${label}-${run}.json`;
        await writeFile(path.join(output, traceName), trace);
        // Keep a small, independently readable trace slice alongside all raw traces.
        // Only renderer-main tasks overlapping the explicit measured interval belong here.
        const events = JSON.parse(trace).traceEvents;
        const startMark = events.find((e) => e.name === 'tree-entry-start');
        const endMark = events.find((e) => e.name === 'tree-entry-end');
        assert.ok(startMark && endMark, 'Trace must contain both measured-interval marks');
        const tasks = events.filter((e) => e.pid === startMark.pid && e.tid === startMark.tid && e.ph === 'X' &&
          e.name === 'ThreadControllerImpl::RunTask' && e.ts < endMark.ts && e.ts + e.dur > startMark.ts);
        const traceSlice = { traceName, sha256: createHash('sha256').update(trace).digest('hex'),
          start: startMark, end: endMark, mainTasks: tasks };
        await writeFile(path.join(output, `slice-${label}-${run}.json`), JSON.stringify(traceSlice, null, 2));
        traceSlices.push(traceSlice);
        const result = { label, size, roots, entries: prepared.entries, run, ...measured, traceLargestTaskMs: Math.max(0, ...tasks.map((e) => e.dur / 1000)),
          heapBeforeBytes: before.usedSize, heapAfterBytes: after.usedSize,
          heapRetainedBytes: retained.usedSize, heapRetainedDeltaBytes: retained.usedSize - before.usedSize, errors };
        runs.push(result);
        console.log(JSON.stringify(result));
      }
      assert.deepEqual(errors, [], `${label} run ${run} (0 is warm-up)`);
      await context.close();
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = scenarios.map(({ label, size, roots }) => {
    const group = runs.filter((r) => r.label === label);
    return { label, size, roots, n: group.length, metrics: Object.fromEntries(['entryMs', 'largestTaskMs', 'traceLargestTaskMs', 'totalBlockingMs', 'elements', 'rows',
      'heapBeforeBytes', 'heapAfterBytes', 'heapRetainedBytes', 'heapRetainedDeltaBytes'].map((key) => [key,
      { median: median(group.map((r) => r[key])), worst: Math.max(...group.map((r) => r[key])) }])) };
  });
  const sourceFiles = ['src/lib/components/TreeView.svelte', 'src/lib/graph-utils.ts',
    'scripts/diagnostics/tree-entry/TreeEntryHarness.svelte', 'scripts/diagnostics/tree-entry/run.mjs',
    'scripts/synth-memory.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) =>
    [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
  const report = { sourceCommit, sourceStatus, sourceSha256,
    browser: browser.version(), os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    headed: true, display: process.env.DISPLAY, extensionsDisabled: true, viewport: '1280x900',
    productionCompiled: true, traceCategories: 'devtools.timeline,toplevel,v8,blink.user_timing', runs, summary };
  assert.equal(git('rev-parse', 'HEAD'), sourceCommit, 'Source commit changed during measurement');
  assert.equal(git('status', '--porcelain'), sourceStatus, 'Source tree changed during measurement');
  await writeFile(path.join(output, 'trace-slices.json'), JSON.stringify(traceSlices, null, 2));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
