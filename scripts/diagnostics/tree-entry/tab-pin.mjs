// Refs #1566 (follow-up to #1488 / PR #1564). Real-Chromium regression for the
// windowed Nodes tree: Tab / Shift+Tab out of a focused row that scrolled far
// outside the window. jsdom has no native tab navigation or layout, so the
// mounted tests can only assert the keydown handler's own focus move; this leg
// asserts what the fix relies on in a browser: focus lands on the neighbouring
// row (index +-1), the scroller moved to it, the window re-rendered around it.
// Same fixture and build as run.mjs; no measurement, no clean-tree requirement.
// node scripts/diagnostics/tree-entry/tab-pin.mjs /absolute/scratch/directory
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../..');
assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'Pass an absolute scratch output directory outside the checkout');
const output = path.resolve(process.argv[2]);
assert.ok(!output.startsWith(root + path.sep), 'Keep build output outside the checkout');
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

// The harness's 'small' shape: 50 roots x 10 children, only roots and their
// children expanded = 550 rows in flattened order root0000, root0000:child0..9,
// root0001, ... Every row has a chevron before its link (they all have children).
const ROW_HEIGHT = 28;
const rowId = (i) => { const r = String(Math.floor(i / 11)).padStart(4, '0'); const c = i % 11; return c === 0 ? `root${r}` : `root${r}:child${c - 1}`; };
const FOCUS = 300;

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-extensions'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.prepareTree === 'function');
  const prepared = await page.evaluate(() => window.prepareTree(3292, 50));
  assert.equal(prepared.expectedRows, 550);
  await page.getByRole('button', { name: 'Enter Tree' }).click();
  await page.waitForSelector('[data-done="true"]');

  // Where focus is, as the harness page sees it: row index, scroller position, mounted rows.
  const state = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return page.evaluate(() => {
    const pane = document.querySelector('.pane');
    const mounted = [...document.querySelectorAll('.tree-row')].map((r) => r.dataset.nodeId);
    const active = document.activeElement?.closest('.tree-row');
    const paneRect = pane.getBoundingClientRect();
    const rect = active?.getBoundingClientRect();
    return { scrollTop: pane.scrollTop, mounted, focusedId: active?.dataset.nodeId ?? null,
      pinned: active ? active.style.position === 'absolute' : null,
      inView: rect ? rect.bottom > paneRect.top && rect.top < paneRect.bottom : false,
      onTreeControl: Boolean(active) };
  }); };
  const rowControl = (i, which) => page.locator(`.tree-row[data-node-id="${rowId(i)}"]`).locator(which === 'first' ? 'button' : 'a').first();
  // Far-scroll the scroller with a real scroll, then let the window re-render.
  const scrollFar = async (top) => {
    await page.evaluate((t) => { document.querySelector('.pane').scrollTop = t; }, top);
    await page.waitForFunction((t) => Math.abs(document.querySelector('.pane').scrollTop - t) < 1, top);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  // A row far down is not mounted until the window reaches it: scroll there, then focus.
  const focusAt = async (i, which) => { await scrollFar(ROW_HEIGHT * (i - 3)); await rowControl(i, which).focus(); };
  const check = (label, s, expected) => {
    assert.equal(s.focusedId, rowId(expected), `${label}: focused row`);
    assert.ok(s.inView, `${label}: the scroller moved so the focused row is in view`);
    assert.ok(s.mounted.length <= 150, `${label}: window stays bounded (${s.mounted.length})`);
    // The window re-rendered around the new focus: rows on both sides are mounted.
    for (const i of [expected - 2, expected - 1, expected, expected + 1, expected + 2]) {
      assert.ok(s.mounted.includes(rowId(i)), `${label}: row ${i} mounted around focus ${expected}`);
    }
    assert.equal(s.pinned, false, `${label}: the row is back inside the window, not pinned`);
  };

  // Tab: focus the last control (the link) of a row, scroll far away, press Tab.
  await focusAt(FOCUS, 'last');
  await scrollFar(ROW_HEIGHT * 20);
  let s = await state();
  assert.equal(s.focusedId, rowId(FOCUS), 'precondition: focus survives being scrolled out');
  assert.equal(s.pinned, true, 'precondition: the focused row is pinned outside the window');
  assert.ok(s.mounted.includes(rowId(FOCUS)) && !s.mounted.includes(rowId(FOCUS + 1)), 'precondition: neighbour not mounted');
  await page.keyboard.press('Tab');
  s = await state();
  check('Tab', s, FOCUS + 1);
  // Without the fix the native Tab from the pinned (last-in-DOM) row leaves the
  // tree, so focus is not on any tree row at all; with it, a second Tab walks on.
  await focusAt(FOCUS + 1, 'last');
  await scrollFar(ROW_HEIGHT * 20);
  await page.keyboard.press('Tab');
  check('Tab again', await state(), FOCUS + 2);

  // Shift+Tab: focus the first control (the chevron), scroll far, press Shift+Tab.
  await focusAt(FOCUS, 'first');
  await scrollFar(ROW_HEIGHT * 500);
  s = await state();
  assert.equal(s.pinned, true, 'precondition (shift): the focused row is pinned outside the window');
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab', await state(), FOCUS - 1);

  assert.deepEqual(errors, []);
  console.log('tab-pin: OK (Tab, Tab again, Shift+Tab from a far pinned row, real Chromium ' + browser.version() + ')');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
