// #1826: the Org Integrations "Add / select / Configure" row must stay inside
// a phone screen. At a 390px viewport the content column is 308-324px but the
// unwrapped row needs ~340px, so Configure ran past the edge and dragged the
// page sideways (Garth's retained captures: 406px wide at a 390px viewport).
// Real Chromium, like test-usage-toolbar-layout: the real component is mounted
// through Vite with the compiled app.css, in the column a 390px viewport leaves.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:org-integrations-row-layout
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

  for (const [width, column] of [[390, 308], [390, 324], [320, 238], [1280, 1000]]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.goto(new URL('/@vite/client', origin).href);
      await page.evaluate(([css, dark]) => {
        document.head.innerHTML = '';
        document.documentElement.classList.toggle('dark', dark);
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, [css, dark]);
      await page.addStyleTag({ content: `#col { width: ${column}px; margin: 0 auto; }` });
      await page.evaluate(async () => {
        const { mountAddRow } = await import('/src/lib/test/fixtures/add-integration-row-harness.ts');
        mountAddRow(document.getElementById('col'));
      });
      await page.waitForSelector('#addIntegration');

      const measure = () => page.evaluate(() => {
        const col = document.getElementById('col').getBoundingClientRect();
        const controls = [...document.querySelectorAll('#col select, #col button')];
        return {
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          colRight: col.right,
          controls: controls.length,
          rects: controls.map((el) => { const b = el.getBoundingClientRect(); return { right: b.right, left: b.left, w: b.width }; }),
          reachable: controls.every((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return b.width > 0 && b.left >= 0 && b.right <= document.documentElement.clientWidth && (hit === el || el.contains(hit));
          }),
        };
      });
      const got = await measure();
      const label = `${width}px viewport, ${column}px column, ${dark ? 'dark' : 'light'}`;
      assert.equal(got.controls, 2, `${label}: select and Configure expected`);
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      assert.ok(got.rects.every((r) => r.right <= got.colRight + 0.5), `${label}: a control runs past the column (${JSON.stringify(got.rects)})`);
      assert.ok(got.reachable, `${label}: a control is off-screen or covered`);

      if (width === 390 && column === 308 && !dark) {
        // Prove the browser sees the defect: take the wrap away and the row
        // must overflow its column, or this check cannot tell fixed from broken.
        const mutant = await page.addStyleTag({ content: '[data-testid="add-integration-row"] { flex-wrap: nowrap !important; } [data-testid="add-integration-row"] > select { min-width: auto !important; max-width: none !important; flex: none !important; }' });
        const m = await measure();
        assert.ok(m.rects.some((r) => r.right > m.colRight + 0.5) || m.scrollWidth > width, 'no-wrap mutant must overflow the column');
        await mutant.evaluate((el) => el.remove());
      }
      console.log(JSON.stringify({ width, column, dark, scrollWidth: got.scrollWidth, rects: got.rects }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
