// portal#2564: the worker detail H1 must stay inside the viewport for a name
// with no break opportunity (`Wrkr` + 60 `Q`). Unwrapped, the heading's
// min-content width set the page's width and dragged the page sideways.
// Real Chromium: the real title row is mounted through Vite with the compiled
// app.css, in the page's own max-w-3xl column.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:worker-title-row-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const NAME = 'Wrkr' + 'Q'.repeat(60);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
async function gotoFixtureDocument(page, origin) {
  await page.route('**/__worker_title_row_fixture*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Worker title row</title>' }));
  const response = await page.goto(new URL('/__worker_title_row_fixture', origin).href);
  assert.equal(response?.status(), 200, `fixture document was not served inert (HTTP ${response?.status()})`);
}

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `compiled app.css was not served (HTTP ${cssResponse.status})`);
  const css = await cssResponse.text();
  assert.ok(css.length > 1000, `compiled app.css looks empty (${css.length} bytes)`);
  browser = await chromium.launch({ headless: true });

  for (const width of [390, 1280]) {
    for (const dark of [false, true]) {
      const label = `${width}px viewport, ${dark ? 'dark' : 'light'}`;
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await gotoFixtureDocument(page, origin);
      await page.evaluate(([css, dark]) => {
        document.head.innerHTML = '';
        document.documentElement.classList.toggle('dark', dark);
        document.body.innerHTML = `<style>${css}</style><main class="mx-auto max-w-3xl px-4 py-6" id="col"></main>`;
      }, [css, dark]);
      await page.evaluate(async (name) => {
        const { mountTitleRow } = await import('/src/lib/test/fixtures/worker-title-row-harness.ts');
        mountTitleRow(document.getElementById('col'), name);
      }, NAME);
      await page.waitForSelector('h1');

      const measure = () => page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const b = h1.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(h1).lineHeight);
        return {
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          h1Right: b.right,
          h1Left: b.left,
          lines: Math.round(b.height / lineHeight),
          text: h1.textContent,
          hScrollable: h1.scrollWidth > h1.clientWidth + 0.5,
          actionsRight: document.querySelector('[data-testid="actions"]').getBoundingClientRect().right,
        };
      });
      const got = await measure();
      assert.equal(got.viewport, width, `${label}: page is not laid out at ${width}px`);
      assert.equal(got.text, NAME, `${label}: the full name must stay in the heading`);
      assert.ok(got.scrollWidth <= width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      assert.ok(got.h1Left >= 0 && got.h1Right <= width, `${label}: heading runs outside the viewport (${got.h1Left}..${got.h1Right})`);
      assert.ok(!got.hScrollable, `${label}: heading clips its own text`);
      assert.ok(got.actionsRight <= width, `${label}: actions button is off-screen`);
      if (width === 390) assert.ok(got.lines >= 2, `${label}: a 64-character name must wrap at phone width (${got.lines} line)`);

      // The check must be able to fail: take the fix away and the page must overflow at phone width.
      if (width === 390) {
        const mutant = await page.addStyleTag({ content: 'h1 { min-width: auto !important; overflow-wrap: normal !important; }' });
        const m = await measure();
        assert.ok(m.scrollWidth > width, `${label}: no-fix mutant must overflow (scrollWidth ${m.scrollWidth})`);
        await mutant.evaluate((el) => el.remove());
      }
      console.log(JSON.stringify({ width, dark, scrollWidth: got.scrollWidth, lines: got.lines }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
