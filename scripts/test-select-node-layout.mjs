// portal#1576: the SelectNode picker must stay inside a phone screen and a
// desktop one, in light and dark, across its states — the memory stage, the
// searched results table, the Load-more stop, the widest row a 200-character
// URN makes, and the failed read's retry state. jsdom has no layout engine,
// so this is real Chromium, like test-tickers-layout: the real component is
// mounted through Vite with the compiled app.css, driving the real UI (the
// nested memory pick, the search, Load more) against URL-routed fetch stubs.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:select-node-layout   (SELECT_NODE_SHOTS=shots for screenshots)
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// portal#1151: the first import of the harness makes Vite re-optimize
// dependencies and reload every page it is serving; each view is set up from
// a blank document and a setup interrupted by a reload starts again from the
// top. Copied from test-tickers-layout.mjs.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountView(page, origin, css, view) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.evaluate(async (view) => {
        const { mountSelectNode } = await import('/src/lib/test/fixtures/select-node-harness.ts');
        await mountSelectNode(document.getElementById('col'), view);
      }, view);
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  const views = ['memory-stage', 'results', 'results-long-urn', 'more', 'failed'];
  // 375 too: hrn:node:hadronmemory.com:hadron-portal:findings:fixed-picker-columns-hide-select-on-phones — the #1200
  // defect showed up at 375 before 390, and a page-scroll-width check misses it
  // (the table scrolls internally). Select's own bounds are the real probe.
  for (const width of [375, 390, 1280]) {
    for (const view of views) {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await mountView(page, origin, css, view);
        // The root layout paints the page (src/routes/+layout.svelte): zinc-950 dark, zinc-50 light.
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');
        await page.waitForSelector('[role="dialog"]');

        const label = `${view} (${scheme}) at ${width}px`;
        const got = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          rows: document.querySelectorAll('tr').length,
          footer: document.querySelector('[role="dialog"]')?.textContent ?? '',
          alert: document.querySelector('[role="alert"]')?.textContent ?? null,
          loadMore: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Load more nodes'),
          // The picker's own search input is the thing a keyboard user lands
          // on. It is named by its visible wrapping label ("Search nodes"),
          // not an aria-label of its own — reach it through the label.
          search: [...document.querySelectorAll('label')].some((l) => l.textContent?.includes('Search nodes') && l.querySelector('input')),
        }));
        assert.equal(got.dialogs >= 1, true, `${label}: no dialog`);
        assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width}) — a long URN or loc runs the modal wide`);
        if (view === 'memory-stage') {
          assert.equal(got.search, false, `${label}: the memory stage must not show the node search yet`);
        } else {
          assert.equal(got.search, true, `${label}: the node search must be reachable`);
        }
        if (view === 'results' || view === 'results-long-urn') {
          assert.equal(got.loadMore, false, `${label}: a short page must end Load more`);
          // 20 + 3 rows loaded; DataTable shows 10 per page, so the DOM holds
          // 1 header + 10 rows and the footer counts all 23 (Page 1 of 3).
          assert.ok(got.rows >= 11, `${label}: expected rows in the DOM, got ${got.rows}`);
          assert.ok(got.footer.includes('Page 1 of 3'), `${label}: all 23 rows must have landed, the dialog has no "Page 1 of 3"`);
        }
        if (view === 'more') assert.equal(got.loadMore, true, `${label}: a full page must offer Load more`);
        if (view === 'failed') {
          assert.ok(got.alert && got.alert.includes('Couldn’t load nodes'), `${label}: the failed read must show its retry alert`);
        }
        // Geometry of the primary action (the #1200 defect class): the Select
        // button must sit inside the viewport, not merely inside a table the
        // user could scroll sideways. Only the three table views have Select
        // buttons (the failed read has no rows; the memory stage's buttons
        // belong to the nested SelectMemory).
        if (view === 'results' || view === 'results-long-urn' || view === 'more') {
          // #1605: each row's Select is named after its node ("Select Node 0 — …").
          const select = page.getByRole('button', { name: /^Select Node / }).first();
          await select.waitFor();
          const box = await select.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
          });
          assert.ok(box.left >= 0 && box.right <= box.viewport, `${label}: Select off-screen: ${JSON.stringify(box)}`);
          if (width === 390 && view === 'results-long-urn') {
            // Negative control: a forced-wide table must push Select off-screen,
            // proving the geometry assertion observes the defect class.
            const mutant = await page.addStyleTag({ content: '[role="dialog"] table { width: 700px !important; min-width: 700px !important; }' });
            assert.ok((await select.evaluate((button) => button.getBoundingClientRect().right)) > width, 'wide-grid control must move Select off-screen');
            await mutant.evaluate((el) => el.remove());
            assert.ok((await select.evaluate((button) => button.getBoundingClientRect().right)) <= width);
          }
        }
        if (process.env.SELECT_NODE_SHOTS) await page.screenshot({ path: `${process.env.SELECT_NODE_SHOTS}/select-node-${view}-${width}-${scheme}.png`, fullPage: true });
        await page.close();
      }
    }
  }
  console.log('select-node layout: all views inside the viewport, light and dark');
} finally {
  await browser?.close();
  await server.close();
}
