// portal#1099: the Tickers list, a ticker page and the Wake-ups panel must
// stay inside a phone screen. jsdom has no layout engine, so this is real
// Chromium, like test-usage-toolbar-layout: the real components are mounted
// through Vite with the compiled app.css, in the 308px content column a 390px
// viewport leaves. At 390px the grid keeps Ticker, State and Every on screen,
// and the Wake-ups status sentence comes first.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:tickers-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';


// portal#1151: the first import of the harness makes Vite discover and re-optimize dependencies,
// and it then reloads every page it is serving. A page that was mid-`evaluate` died with
// "Execution context was destroyed, most likely because of a navigation": CI's slower runner hit
// it on the 1280px legs once the Tickers pages grew. Each view is therefore set up from a
// document that has no script of its own (the old /@vite/client address was a SvelteKit 404 page
// that hydrates), and a setup that a reload interrupts starts again from the top. A setup that
// fails any other way still fails.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountView(page, origin, css, width, view) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 1000}px; margin: 40px; }` });
      await page.evaluate(async (view) => {
        const { mountTickers } = await import('/src/lib/test/fixtures/tickers-harness.ts');
        mountTickers(document.getElementById('col'), view);
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

  // portal#1497: the ticker page now carries the on/off control and the
  // subscriber controls, each with its own bad states — the roster's three,
  // the stale row, an uncertain result and the failed-refresh line — and the
  // whole set is checked in light AND in dark (.dark on the root).
  const views = [
    'list', 'detail', 'detail-unmapped', 'detail-task-failed', 'detail-stale-row',
    'detail-roster-hidden', 'detail-roster-failed', 'detail-roster-empty',
    'detail-uncertain', 'detail-refresh-failed', 'wake',
  ];
  for (const dark of [false, true]) {
  for (const width of [390, 1280]) {
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await mountView(page, origin, css, width, view);
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await page.waitForSelector(view === 'wake' ? '[data-testid="wake-status"]' : view.startsWith('detail') ? '[data-testid="ticker-task"]' : 'table');

      const measure = () => page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const onScreen = (el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.left >= 0 && b.right <= vw;
        };
        const heads = [...document.querySelectorAll('th')].map((th) => ({ text: th.textContent?.trim() ?? '', on: onScreen(th) }));
        const status = document.querySelector('[data-testid="wake-status"]');
        const settings = document.querySelector('[data-testid="wake-settings"]');
        return {
          width: vw,
          scrollWidth: document.documentElement.scrollWidth,
          heads,
          taskEntries: document.querySelectorAll('[data-testid="ticker-task"]').length,
          statusFirst: status && settings ? status.getBoundingClientRect().top < settings.getBoundingClientRect().top : null,
        };
      });
      const got = await measure();
      const label = `${view} at ${width}px${dark ? ' dark' : ''}`;
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      if (view === 'list') {
        for (const col of ['Ticker', 'State', 'Every']) {
          const h = got.heads.find((x) => x.text.startsWith(col));
          assert.ok(h, `${label}: no ${col} column`);
          assert.ok(h.on, `${label}: the ${col} column is off-screen`);
        }
      }
      if (view.startsWith('detail')) assert.equal(got.taskEntries, 1, `${label}: the Task entry must render exactly once`);
      if (view === 'wake') assert.equal(got.statusFirst, true, `${label}: the status sentence must come first`);

      if (width === 390) {
        // Prove the browser sees overflow at all: force the facts/settings
        // grids and the grid wrapper wide, and the page must overflow, or this
        // check could not tell fixed from broken.
        const mutant = await page.addStyleTag({ content: '#col dl, #col section > div, #col table { min-width: 700px !important; width: 700px !important; overflow: visible !important; }' });
        assert.ok((await measure()).scrollWidth > width, `${label}: the wide mutant must overflow`);
        await mutant.evaluate((el) => el.remove());
        assert.equal((await measure()).scrollWidth, width);
      }
      console.log(JSON.stringify({ view, dark, width: got.width, scrollWidth: got.scrollWidth, statusFirst: got.statusFirst }));
      await page.close();
    }
  }
  }
} finally {
  await browser?.close();
  await server.close();
}
