// Real Chromium geometry for bulk apply (#1736); synthetic component fixture, not signed-in/server QA.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'memory-config-navigation-stub', enforce: 'pre', transform(code, id) { return /memory-config\/.*\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null; } }] });
const shots = process.env.MEMORY_CONFIG_SHOTS;
const row = (i, dryRun, outcome) => ({ index: i, memoryRef: `m${i}`, ok: true, error: null, result: { memoryId: `m${i}`, templateRevision: 3, required: true, dryRun, entries: [{ role: 'review', outcome }, { role: 'author', outcome: 'SKIPPED_LOCKED' }], warnings: [] } });
const bad = (i, code, message, extra = {}) => ({ index: i, memoryRef: `m${i}`, ok: false, result: null, error: { code, message, currentRevision: null, requestId: null, ...extra } });
const previewRows = [row(0, true, 'APPLIED'), row(1, true, 'REPLACED'), row(2, true, 'APPLIED'), row(3, true, 'APPLIED'), bad(4, 'MEMORY_NOT_FOUND', 'Memory not found.'), row(5, true, 'SKIPPED_LOCKED')];
const applyRows = [row(0, false, 'APPLIED'), row(1, false, 'SKIPPED_LOCKED'), bad(2, 'CONFLICT', 'Template changed.', { currentRevision: 4 }), bad(3, 'CONFLICT', 'Retry.'), bad(4, 'MEMORY_NOT_FOUND', 'Memory not found.'), bad(5, 'INTERNAL_SERVER_ERROR', 'Internal error.', { requestId: '6f1b4c3e-8a2d-4e5f-9b0c-1d2e3f4a5b6c' })];
const result = (rows, dryRun) => ({ value: { dryRun, results: rows, succeeded: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length } });
let browser;
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 for (const [width, dark, cap] of [320, 390, 768, 1280].flatMap(w => [[w, false, false], [w, true, false], [w, false, true]])) {
  const label = `${width}/${dark ? 'dark' : 'light'}${cap ? '/cap' : ''}`;
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 320 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  page.setDefaultTimeout(10000);
  if (width === 320) assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), `${label}: phone scenario exercises coarse-pointer controls`);
  await page.route('**/__blank', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fixture</title>' }));
  const bodies = []; let lose = false;
  await page.route('**/api/memory-config', r => {
   const body = JSON.parse(r.request().postData()); bodies.push(body);
   if (lose) return r.abort('connectionfailed');
   const rows = body.memoryRefs.length === 6 ? (body.op === 'preview' ? previewRows : applyRows) : body.memoryRefs.map((ref, index) => ({ ...row(index, body.op === 'preview', 'APPLIED'), memoryRef: ref }));
   return r.fulfill({ contentType: 'application/json', body: JSON.stringify(result(rows, body.op === 'preview')) });
  });
  await page.goto(new URL('/__blank', origin).href);
  await page.evaluate(({ css, dark }) => { document.head.innerHTML = `<style>${css}</style>`; document.body.innerHTML = `<div class="min-h-screen ${dark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}"><main style="max-width:1100px;margin:0 16px;padding:16px 0" id="fixture"></main></div>`; document.documentElement.classList.toggle('dark', dark); }, { css, dark });
  await page.evaluate(width => {
   const view = { sorting: [], columnFilters: [], globalFilter: '', columnVisibility: {}, columnOrder: [], columnSizing: { memory: width === 1280 ? 1600 : 280 }, pagination: { pageIndex: 0, pageSize: 50 } };
   const record = { id: 'legacy-280', listKey: 'node-role-template-bulk-apply', name: 'Legacy 280', view, isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
   localStorage.setItem('hadron:views:v1:node-role-template-bulk-apply', JSON.stringify([record]));
  }, width);
  await page.evaluate(async count => { const { mountBulkTemplates } = await import('/src/lib/test/fixtures/memory-config-layout-harness.ts'); mountBulkTemplates(document.getElementById('fixture'), true, count); }, cap ? 51 : 6);
  const shot = name => shots ? page.screenshot({ path: `${shots}/${width}-${dark ? 'dark' : 'light'}-${name}.png`, fullPage: true }) : null;
  const inViewport = async (locator, name) => { const box = await locator.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${label}: ${name} leaves the viewport: ${JSON.stringify(box)}`); };
  const noOverflow = async name => { const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 0, `${label}: ${name} overflows ${over}px`); };
  const clipboardText = async expected => {
   await page.waitForFunction(async value => (await navigator.clipboard.readText()) === value, expected);
  };
  const tableGeometry = async (state, expectedRows) => {
   const tableScroller = panel.locator('table').first().locator('..');
   if (width === 320) {
    const table = await tableScroller.locator('table').elementHandle();
    await page.waitForFunction(el => el.style.width === '100%', table);
    await table.dispose();
    assert.equal(await tableScroller.getByRole('separator').count(), 0, `${label}: ${state} hides the resize separator while phone fitting is active`);
   }
   const scrollerBox = await tableScroller.boundingBox();
   assert.ok(scrollerBox, `${label}: ${state} table scroller is visible`);
   const tableOverflow = await tableScroller.evaluate(el => el.scrollWidth - el.clientWidth);
   if (width === 1280) {
    const tableWidth = await tableScroller.locator('table').evaluate(el => el.getBoundingClientRect().width);
    assert.equal(Math.round(tableWidth), 1600, `${label}: ${state} preserves a wide desktop saved view`);
    assert.ok(tableOverflow > 0, `${label}: ${state} keeps the wide desktop layout inside the table scroller`);
    return;
   }
   for (const name of ['Copy URN', 'Copy URL']) {
    const controls = tableScroller.getByRole('button', { name, exact: true });
    const count = await controls.count();
    assert.equal(count, expectedRows, `${label}: every ${state} row has a ${name} button`);
    for (let i = 0; i < count; i++) {
     const box = await controls.nth(i).boundingBox();
     assert.ok(box && box.x >= scrollerBox.x - 0.5 && box.x + box.width <= scrollerBox.x + scrollerBox.width + 0.5, `${label}: ${state} ${name} ${i + 1} is clipped by the table scroller: ${JSON.stringify({ box, scrollerBox })}`);
    }
    if (state === 'preview') {
     assert.equal(await controls.first().evaluate(el => el.tabIndex), 0, `${label}: ${name} is keyboard reachable`);
     await controls.first().focus();
     assert.ok(await controls.first().evaluate(el => el === document.activeElement), `${label}: ${name} accepts focus`);
    }
   }
   const outcomeTexts = tableScroller.locator('tbody td > div > div:last-child :is(li, p)');
   const outcomeCount = await outcomeTexts.count();
   assert.ok(outcomeCount > 0, `${label}: ${state} has outcome text to measure`);
   for (let i = 0; i < outcomeCount; i++) {
    const outcome = outcomeTexts.nth(i);
    const box = await outcome.boundingBox();
    assert.ok(box && box.x >= scrollerBox.x - 0.5 && box.x + box.width <= scrollerBox.x + scrollerBox.width + 0.5, `${label}: ${state} outcome ${i + 1} is clipped by the table scroller`);
    assert.ok(await outcome.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: ${state} outcome ${i + 1} clips its own text`);
   }
   assert.ok(tableOverflow <= 0, `${label}: ${state} table needs ${tableOverflow}px of horizontal scrolling`);
   if (state === 'preview') {
    const urn = 'hrn:mem:acme.example:fixture-memory-with-a-long-slug-0';
    await tableScroller.getByRole('button', { name: 'Copy URN', exact: true }).first().click();
    await clipboardText(urn);
    await tableScroller.getByRole('button', { name: 'Copy URL', exact: true }).first().click();
    await clipboardText(`${new URL(origin).origin}/app/u/${urn}`);
   }
  };
  await page.getByRole('button', { name: 'Apply to several memories…', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Apply to several memories', exact: true });
  await panel.getByRole('button', { name: 'Add memories…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a memory', exact: true });
  const dimmed = async name => { const button = page.getByRole('button', { name, exact: true }).first(); assert.ok(await button.isDisabled(), `${label}: ${name} is disabled`); assert.equal(await button.evaluate(b => getComputedStyle(b).opacity), '0.5', `${label}: ${name} looks disabled`); };
  if (cap) {
   const open = picker.getByRole('button', { name: /^Select / });
   for (let picked = 0; picked < 50;) {
    if (await open.count()) { await open.first().click(); picked++; }
    else await picker.getByRole('button', { name: 'Next →', exact: true }).click();
   }
   await picker.getByRole('button', { name: /^Added / }).first().waitFor();
   if (!await open.count()) await picker.getByRole('button', { name: 'Next →', exact: true }).click();
   await open.first().click();
   await picker.getByText('One apply takes at most 50 memories, so this one was not added.').waitFor();
   await picker.getByRole('button', { name: 'Done', exact: true }).click();
   await panel.getByText('50 of 50 chosen. One apply takes at most 50 memories.').waitFor();
   await dimmed('Add memories…');
   assert.equal(await panel.getByRole('button', { name: /^Remove / }).count(), 50, `${label}: fifty rows, not fifty-one`);
   await noOverflow('fifty chosen');
   const previewButton = panel.getByRole('button', { name: 'Preview', exact: true });
   await previewButton.scrollIntoViewIfNeeded(); await inViewport(previewButton, 'Preview at the cap'); await previewButton.click();
   await panel.getByText('50 will change, 0 will be skipped, 0 can’t be applied').waitFor();
   await tableGeometry('cap preview', 50);
   const applyButton = panel.getByRole('button', { name: 'Apply and lock rules', exact: true });
   await applyButton.scrollIntoViewIfNeeded(); await inViewport(applyButton, 'Apply at the cap'); await applyButton.click();
   await panel.getByText('50 changed, 0 changed nothing, 0 failed').waitFor();
   assert.equal(bodies.at(-1).memoryRefs.length, 50, `${label}: fifty refs sent`);
   await noOverflow('fifty applied');
   await tableGeometry('cap report', 50);
   console.log(`${label} PASS: fifty chosen, a 51st refused, fifty previewed and applied, controls reachable`);
   await page.close();
   continue;
  }
  await picker.getByRole('button', { name: 'Select Fixture memory 0', exact: true }).click();
  await picker.getByRole('button', { name: 'Added Fixture memory 0', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Added Fixture memory 0', `${label}: picking keeps focus on the row`);
  for (const i of [1, 2, 3, 4]) await picker.getByRole('button', { name: `Select Fixture memory ${i}`, exact: true }).click();
  await picker.getByRole('button', { name: 'Next →', exact: true }).click();
  const last = picker.getByRole('button', { name: /^Select A memory with quite/ });
  await inViewport(last, 'picker Select'); await last.click();
  const done = picker.getByRole('button', { name: 'Done', exact: true });
  await inViewport(done, 'picker Done');
  await shot('picker');
  await done.click();
  await inViewport(panel.getByRole('button', { name: 'Remove Fixture memory 0', exact: true }), 'Remove');
  await noOverflow('selection');
  await panel.getByRole('button', { name: 'Preview', exact: true }).click();
  await panel.getByText('4 will change, 1 will be skipped, 1 can’t be applied').waitFor();
  for (const name of ['Create template', 'Edit', 'Delete', 'Apply to a memory…', 'Apply to several memories…']) await dimmed(name);
  await noOverflow('preview');
  await tableGeometry('preview', 6);
  if (width !== 1280) await inViewport(panel.getByText('Will be replaced').first().or(panel.getByText('review: Will be replaced')).first(), 'row outcome');
  await shot('preview');
  await panel.getByRole('button', { name: 'Apply and lock rules', exact: true }).click();
  await panel.getByText('1 changed, 1 changed nothing, 4 failed').waitFor();
  await noOverflow('report');
  await tableGeometry('report', 6);
  if (width !== 1280) await inViewport(panel.getByText(/Request ID:/), 'request id');
  await shot('report');
  await panel.getByRole('button', { name: 'Retry failed', exact: true }).click();
  await panel.getByText('Preview: nothing has been changed').waitFor();
  await tableGeometry('retry preview', 6);
  assert.deepEqual(bodies.at(-1).memoryRefs, ['m2', 'm3', 'm4', 'm5'], `${label}: retry sends failed rows only`);
  lose = true;
  await panel.getByRole('button', { name: 'Apply and lock rules', exact: true }).click();
  await panel.getByText('We don’t know which memories were changed.').waitFor();
  await noOverflow('unknown');
  await tableGeometry('unknown outcome', 6);
  await inViewport(panel.getByRole('button', { name: 'Start a new apply…', exact: true }), 'Start a new apply');
  await shot('unknown');
  console.log(`${label} PASS: page overflow and table geometry checked, retry scope, unknown outcome`);
  await page.close();
 }
} finally { await browser?.close(); await server.close(); }
