// portal#2367: the DataTable fill sizing in real Chromium with the compiled app.css, inside the
// app shell's own row and content classes (src/lib/layout/app-shell.ts). jsdom cannot lay out, so
// the unit suite stands geometry in; this is the layout truth. Synthetic data only.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:data-table-fill-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

async function gotoFixtureDocument(page, origin) {
  await page.route('**/__data_table_fill_fixture*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>test-data-table-fill-layout</title>' }));
  const response = await page.goto(new URL('/__data_table_fill_fixture', origin).href);
  assert.equal(response?.status(), 200, `fixture document was not served inert (HTTP ${response?.status()})`);
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
const geometry = (page) => page.evaluate(() => {
  const scroller = document.querySelector('[data-testid="data-table-scroller"]');
  const footer = document.querySelector('[data-testid="table-footer"]');
  const lastRow = scroller.querySelector('tbody tr:last-child');
  return {
    viewport: window.innerHeight,
    footerTop: footer.getBoundingClientRect().top + window.scrollY,
    footerBottom: footer.getBoundingClientRect().bottom + window.scrollY,
    lastRowBottom: lastRow.getBoundingClientRect().bottom + window.scrollY,
    overflowing: scroller.scrollHeight > scroller.clientHeight,
    scrollY: window.scrollY,
  };
});
// Every ancestor of the scroller between it and the root must leave scrolling to the document.
const clippingAncestors = (page) => page.evaluate(() => {
  const out = [];
  for (let el = document.querySelector('[data-testid="data-table-scroller"]').parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    const clips = (v) => v !== 'visible';
    const isRoot = el === document.documentElement;
    if (clips(s.overflowY) && !(isRoot && s.overflowY === 'auto') || (el === document.body && clips(s.overflowX))) out.push(`${el.tagName}.${el.className} overflow=${s.overflowX}/${s.overflowY}`);
    if (/^(fixed)$/.test(s.position)) out.push(`${el.tagName}.${el.className} position=fixed`);
  }
  return out;
});

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.equal(cssResponse.status, 200, `app.css was not served (HTTP ${cssResponse.status})`);
  const css = await cssResponse.text();
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    for (const dark of [false, true]) {
      const label = `${width}x${height}${dark ? ' dark' : ' light'}`;
      const open = async (props) => {
        const page = await browser.newPage({ viewport: { width, height } });
        await gotoFixtureDocument(page, origin);
        await page.evaluate(({ css, dark }) => {
          document.head.innerHTML = '';
          document.body.innerHTML = `<style>${css}</style><main id="app"></main>`;
          document.documentElement.classList.toggle('dark', dark);
        }, { css, dark });
        await page.evaluate(async (props) => {
          const { mountFill } = await import('/src/lib/test/fixtures/data-table-fill-harness.ts');
          mountFill(document.getElementById('app'), props);
        }, props);
        await page.locator('[data-testid="table-footer"]').waitFor();
        if (props.rows > 25) await page.locator('[data-testid="table-footer"] select').selectOption('100');
        await frames(page);
        return page;
      };

      // A long list: the footer ends inside the window, then still does after a header above grows.
      let page = await open({ rows: 80, headerHeight: 120 });
      let g = await geometry(page);
      assert.ok(g.overflowing, `${label}: an 80-row list must overflow its scroller: ${JSON.stringify(g)}`);
      assert.ok(g.footerBottom <= g.viewport + 1, `${label}: footer within the window: ${JSON.stringify(g)}`);
      assert.deepEqual(await clippingAncestors(page), [], `${label}: the document, not an ancestor, owns page scrolling`);
      // The body is already at its minimum height, so growing the header resizes neither it nor
      // the footer: only a watcher of the header itself can notice (the defect on main).
      await page.evaluate(() => { document.body.style.minHeight = '3000px'; });
      await frames(page);
      await page.evaluate(() => { document.querySelector('[data-testid="page-header"]').style.height = '320px'; });
      await frames(page);
      g = await geometry(page);
      assert.ok(g.footerBottom <= g.viewport + 1, `${label}: footer within the window after the header grew: ${JSON.stringify(g)}`);
      // Control: an ancestor that scrolls must be caught by the ownership check.
      await page.evaluate(() => { document.querySelector('[data-testid="shell-content"]').style.overflow = 'auto'; });
      assert.ok((await clippingAncestors(page)).length > 0, `${label}: control: a scrolling ancestor is reported`);
      await page.close();

      // A short list: the footer sits directly under the last row, not at the window bottom.
      page = await open({ rows: 2, headerHeight: 120 });
      g = await geometry(page);
      assert.ok(g.footerTop >= g.lastRowBottom - 1 && g.footerTop - g.lastRowBottom <= 24, `${label}: footer starts at or below the last row and within 24px of it: ${JSON.stringify(g)}`);
      assert.ok(g.footerBottom < g.viewport - 150, `${label}: short list footer is not pinned to the window bottom: ${JSON.stringify(g)}`);
      await page.close();

      // A bounded list keeps its fixed cap whatever the window does.
      page = await open({ rows: 80, headerHeight: 120, bounded: true });
      const cap = await page.evaluate(() => document.querySelector('[data-testid="data-table-scroller"]').getBoundingClientRect().height);
      assert.ok(Math.abs(cap - Math.max(200, height * 0.4)) <= 2, `${label}: bounded height ${cap}`);
      await page.close();
      console.log(JSON.stringify({ label, ok: true }));
    }
  }
} finally {
  await browser?.close(); await server.close();
}
