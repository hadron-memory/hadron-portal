// #1942: real components/CSS, synthetic data only. No production or backend.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
 name: 'table-cell-fixture', enforce: 'pre', transform(code, id) {
  if (/\/(AppRunsTable|TasksAlarms|AiServiceConfigManager)\.svelte$/.test(id)) return code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'");
  // Expose only the fixture's actual table objects, no production test API.
  if (id.endsWith('/createSvelteTable.svelte.ts')) return code.replace('return createTable(withFeatures(options));', 'const fixtureTable = createTable(withFeatures(options)); globalThis.__fixtureTables ??= []; globalThis.__fixtureTables.push(fixtureTable); return fixtureTable;');
 }
}] });
let browser;
const failures = [];
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('/src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 if (process.env.CELL_SHOTS) await mkdir(process.env.CELL_SHOTS, { recursive: true });
 for (const width of [390, 1280]) for (const dark of [false, true]) for (const kind of ['alarms', 'runs', 'config']) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  await page.route('**/api/ai-configs', r => r.fulfill({ contentType: 'application/json', body: '{"endpoints":[]}' }));
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async kind => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = mountOverflowFixture(document.getElementById('fixture'), kind); }, kind);
   await page.locator('tbody td').first().waitFor();
   // Net OFF: the containment rule must not hide a failed per-kind repair.
   await page.addStyleTag({ content: 'td { overflow: visible !important; }' });
   // Restore an old undersized saved view through the real setter. Interactive
   // columns must use the declared minimum; text columns remain narrowable.
   await page.evaluate(() => { const t = window.__fixtureTables.at(-1); t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c => [c.id, 120]))); });
   await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
   const geometry = await page.locator('tbody td').evaluateAll(cells => cells.map(td => {
    const rect = td.getBoundingClientRect();
    return { text: td.textContent.slice(0, 80), width: rect.width, scroll: td.scrollWidth, client: td.clientWidth };
   }));
   const overflow = geometry.filter(x => x.scroll > x.client + 1);
   if (overflow.length) failures.push(`${kind}/${width}/${dark}: net-off cell paint overflow ${JSON.stringify(overflow)}`);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'internal scroller, not document overflow');
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/${kind}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
   assert.deepEqual(errors, [], 'no browser errors');
   console.log(`${kind}/${width}/${dark ? 'dark' : 'light'}: ${overflow.length ? 'RED' : 'PASS'} net-off`, JSON.stringify(geometry));
  } finally { await page.close(); }
 }
 assert.deepEqual(failures, []);
} finally { await browser?.close(); await server.close(); }
