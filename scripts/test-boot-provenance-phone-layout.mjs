// portal#1991: the boot prompt provenance table needs no sideways scroll on a
// phone, and a desktop keeps its restored saved-view widths and column
// resizing. Real Chromium, real BootProvenance/DataTable, synthetic transport.
// Author layout evidence only, never a sign-in, provider or QA claim.
//
// The oracle is the table's INTERNAL scroller, not the document: the #1851
// limit was a 470px table inside a 272px scroller while page overflow read 0
// (hrn:node:hadronmemory.com:hadron-portal:review:datatable-width-fix-covers-saved-views-and-touch).
// Phones seed a saved view WIDER than any phone scroller, so only the phone
// layout passes; 1280 seeds a 1600px desktop view that must survive intact.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const shots = process.env.BOOT_PROVENANCE_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const LIST_KEY = 'boot-prompt-provenance';
const savedSizing = width => width === 1280 ? { name: 900, selection: 400, pruned: 300 } : width < 640 ? { name: 500, selection: 300, pruned: 200 } : null;
// What each row must still say on a phone, where the two narrow columns fold away.
const expected = [
  ['Engineering safety and collaboration', 'Latest revision · Approved only', 'Kept'],
  ['Not available to you', 'Latest revision · Approved only'],
  ['Previous operating guide', 'Revision 4 · Approved and signed only', 'No longer kept'],
];
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
let checked = 0;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1280]) for (const theme of ['light', 'dark']) {
    const label = `${width}/${theme}`;
    const phone = width < 640;
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: phone });
    page.setDefaultTimeout(10000);
    await page.route('**/__blank1991', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Boot provenance layout</title>' }));
    // Vite's first dependency re-optimization can reload the blank page at any
    // point. Retry the whole interaction at most six times; never retry assertions.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(new URL('/__blank1991', origin).href);
        assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), phone, `${label}: phone scenarios run with a coarse pointer, desktop with a fine one`);
        await page.evaluate(({ css, theme, sizing, listKey }) => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          // A phone page column: 16px gutters on each side, as the agent page lays it out.
          document.body.innerHTML = `<style>${css}</style><main id="col" style="max-width:1000px;margin:24px 16px"></main>`;
          document.body.style.background = theme === 'dark' ? '#09090b' : '#fafafa';
          localStorage.clear();
          if (sizing) {
            const view = { sorting: [], columnFilters: [], globalFilter: '', columnVisibility: {}, columnOrder: [], columnSizing: sizing, pagination: { pageIndex: 0, pageSize: 20 } };
            localStorage.setItem(`hadron:views:v1:${listKey}`, JSON.stringify([{ id: 'saved-widths', listKey, name: 'Saved widths', view, isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]));
          }
        }, { css, theme, sizing: savedSizing(width), listKey: LIST_KEY });
        await page.evaluate(async () => { const { mountBootProvenance } = await import('/src/lib/test/fixtures/boot-install-harness.ts'); mountBootProvenance(document.getElementById('col')); });
        await page.locator('tbody td').filter({ hasText: 'Not available to you' }).waitFor();
        const scroller = page.getByTestId('data-table-scroller');
        const geometry = () => scroller.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, table: el.querySelector('table').getBoundingClientRect().width }));
        const rows = page.locator('tbody tr');
        assert.equal(await rows.count(), 3, `${label}: three provenance rows`);
        const headers = page.getByRole('columnheader');

        if (phone) {
          const g = await geometry();
          assert.ok(g.scroll <= g.client, `${label}: the provenance table scrolls sideways inside its scroller (${g.scroll}px content in ${g.client}px; saved view seeded 1000px)`);
          assert.ok(Math.abs(g.table - g.client) <= 1, `${label}: the table fits its scroller (${g.table}px vs ${g.client}px)`);
          assert.equal(await headers.count(), 1, `${label}: one visible column header on a phone`);
          assert.equal(await page.getByTestId('data-table-scroller').getByRole('separator').count(), 0, `${label}: no resize handle while the phone layout is active`);
          // Nothing is lost: each row still carries its settings and retention, as visible text.
          for (let i = 0; i < expected.length; i++) {
            const row = rows.nth(i);
            for (const piece of expected[i]) assert.ok((await row.innerText()).includes(piece), `${label}: row ${i + 1} shows "${piece}" on a phone`);
          }
          const box = await scroller.boundingBox();
          const copy = scroller.getByRole('button', { name: 'Copy URN', exact: true });
          assert.equal(await copy.count(), 2, `${label}: both named rows keep their Copy URN control`);
          for (let i = 0; i < 2; i++) {
            const b = await copy.nth(i).boundingBox();
            assert.ok(b && b.x >= box.x - 0.5 && b.x + b.width <= box.x + box.width + 0.5, `${label}: Copy URN ${i + 1} is clipped by the table scroller: ${JSON.stringify({ b, box })}`);
          }
        } else {
          assert.deepEqual((await headers.locator('.truncate').allInnerTexts()).map(h => h.trim().toLowerCase()), ['source', 'include settings', 'text kept'], `${label}: all three columns on a desktop`);
          // The phone-only detail lines stay out of the desktop row (no duplicate of the column text).
          const first = await rows.nth(0).locator('td').first().innerText();
          assert.ok(!first.includes('Approved only'), `${label}: the Source cell does not repeat the settings column on a desktop`);
          for (const h of ['Include settings', 'Text kept']) {
            const m = await headers.filter({ hasText: h }).locator('.truncate').evaluate(el => ({ visible: el.clientWidth, required: el.scrollWidth }));
            assert.ok(m.visible >= m.required, `${label}: ${h} header truncated (${m.visible}/${m.required})`);
          }
          if (width === 1280) {
            const g = await geometry();
            assert.equal(Math.round(g.table), 1600, `${label}: the 1600px saved desktop view is restored`);
            assert.ok(g.scroll > g.client, `${label}: the wide desktop view stays inside the table scroller`);
            // A column drag still resizes on a desktop.
            const separator = headers.filter({ hasText: 'Source' }).getByRole('separator');
            const before = Number(await separator.getAttribute('aria-valuenow'));
            const sb = await separator.boundingBox();
            await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
            await page.mouse.move(sb.x + sb.width / 2 - 120, sb.y + sb.height / 2, { steps: 5 }); await page.mouse.up();
            const after = Number(await separator.getAttribute('aria-valuenow'));
            assert.ok(Math.abs(after - (before - 120)) <= 2, `${label}: dragging the Source edge resizes it (${before} -> ${after})`);
          }
        }
        const doc = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, html: document.body.innerHTML }));
        assert.equal(doc.scroll, doc.width, `${label}: horizontal page overflow`);
        assert.ok(!doc.html.includes('private-node-id'), `${label}: concealed provenance node ID rendered`);
        if (shots) await page.screenshot({ path: `${shots}/provenance-${theme}-${width}.png`, fullPage: true });
        checked++;
        break;
      } catch (e) { if (attempt >= 5 || e?.name === 'AssertionError' || !/Execution context was destroyed|navigation/i.test(String(e))) throw e; }
    }
    await page.close();
  }
  console.log(`PASS: ${checked} real-component Chromium provenance layouts (320/390 touch, 768, 1280; light/dark; synthetic transport only)`);
} finally { await browser?.close(); await server.close(); }
