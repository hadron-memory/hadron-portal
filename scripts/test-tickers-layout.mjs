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

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  for (const width of [390, 1280]) {
    for (const view of ['list', 'detail', 'wake']) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.goto(new URL('/@vite/client', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 1000}px; margin: 40px; }` });
      await page.evaluate(async (view) => {
        const { mountTickers } = await import('/src/lib/test/fixtures/tickers-harness.ts');
        mountTickers(document.getElementById('col'), view);
      }, view);
      await page.waitForSelector(view === 'wake' ? '[data-testid="wake-status"]' : view === 'detail' ? '[data-testid="ticker-facts"]' : 'table');

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
          statusFirst: status && settings ? status.getBoundingClientRect().top < settings.getBoundingClientRect().top : null,
        };
      });
      const got = await measure();
      const label = `${view} at ${width}px`;
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      if (view === 'list') {
        for (const col of ['Ticker', 'State', 'Every']) {
          const h = got.heads.find((x) => x.text.startsWith(col));
          assert.ok(h, `${label}: no ${col} column`);
          assert.ok(h.on, `${label}: the ${col} column is off-screen`);
        }
      }
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
      console.log(JSON.stringify({ view, width: got.width, scrollWidth: got.scrollWidth, statusFirst: got.statusFirst }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
