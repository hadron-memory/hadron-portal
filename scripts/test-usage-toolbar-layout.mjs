// #1112: the memory Usage toolbar must stay inside a phone screen, in both
// panes. At 390px its controls ran to x=498 and dragged the whole page
// sideways (Colin, QA on #1111). jsdom has no layout engine, so this is real
// Chromium, like test-node-phone-layout: the actual page is mounted through
// Vite with the compiled app.css, in the 308px content column a 390px
// viewport leaves (the same column that script uses).
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:usage-toolbar-layout
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
    for (const pane of ['table', 'chart']) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      // The chart pane fetches its series; answer it so the pane settles.
      await page.route('**/usage/activity**', (route) =>
        route.fulfill({ json: { windowDays: 30, timeZone: 'UTC', buckets: [], loadFailed: false } }));
      await page.goto(new URL('/@vite/client', origin).href);
      await page.evaluate(([css, pane]) => {
        localStorage.setItem('hadron:memoryUsage:pane', pane);
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, [css, pane]);
      await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 1000}px; margin: 40px; }` });
      await page.evaluate(async () => {
        const { mountUsagePage } = await import('/src/lib/test/fixtures/usage-page-harness.ts');
        mountUsagePage(document.getElementById('col'));
      });
      await page.waitForFunction((pane) => !!document.querySelector(pane === 'chart' ? '#usage-window' : '[aria-pressed]'), pane);

      const measure = () => page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const controls = [...document.querySelectorAll('section select, section [role="group"] button')];
        return {
          width: vw,
          scrollWidth: document.documentElement.scrollWidth,
          controls: controls.length,
          // Reachable: on-screen AND the topmost element at its own centre, so
          // nothing overlaps it where a tap would land.
          reachable: controls.every((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return b.width > 0 && b.left >= 0 && b.right <= vw && (hit === el || el.contains(hit));
          }),
        };
      });
      const got = await measure();
      const label = `${pane} pane at ${width}px`;
      assert.equal(got.controls, pane === 'chart' ? 4 : 2, `${label}: expected toolbar controls`);
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      assert.ok(got.reachable, `${label}: a toolbar control is off-screen or covered`);

      if (width === 390 && pane === 'chart') {
        // Prove the browser sees the defect: take the toolbar's own wrap away
        // and the page must overflow, or this check cannot tell fixed from
        // broken. (The heading row's wrap is layout, not containment: without
        // it the toolbar still fits, squeezed into a column beside the heading.)
        const row = 'section > div:first-child > div';
        const mutant = await page.addStyleTag({ content: `${row} { flex-wrap: nowrap !important; }` });
        assert.ok((await measure()).scrollWidth > width, 'toolbar no-wrap mutant must overflow');
        await mutant.evaluate((el) => el.remove());
        assert.equal((await measure()).scrollWidth, width);
      }
      console.log(JSON.stringify({ pane, ...got }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
