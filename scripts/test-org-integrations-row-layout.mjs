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
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `compiled app.css was not served (HTTP ${cssResponse.status})`);
  const css = await cssResponse.text();
  assert.ok(css.length > 1000, `compiled app.css looks empty (${css.length} bytes)`);
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
        mountAddRow(document.getElementById('col'), { onconfigure: () => { window.__configured = (window.__configured ?? 0) + 1; } });
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
      assert.equal(got.viewport, width, `${label}: the page is not laid out at ${width}px (viewport meta or emulation)`);
      assert.equal(got.controls, 2, `${label}: select and Configure expected`);
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      assert.ok(got.rects.every((r) => r.right <= got.colRight + 0.5), `${label}: a control runs past the column (${JSON.stringify(got.rects)})`);
      assert.ok(got.reachable, `${label}: a control is off-screen or covered`);

      if (column < 400) {
        // Prove the browser sees the defect in every cell where the row can
        // overflow: take the wrap away and the row must overflow its column, or
        // this check cannot tell fixed from broken. The 1280px / 1000px cells
        // are excluded because the unwrapped row fits there by design.
        const mutant = await page.addStyleTag({ content: '[data-testid="add-integration-row"] { flex-wrap: nowrap !important; } [data-testid="add-integration-row"] > select { min-width: auto !important; max-width: none !important; flex: none !important; }' });
        const m = await measure();
        assert.ok(m.rects.some((r) => r.right > m.colRight + 0.5) || m.scrollWidth > width, `${label}: no-wrap mutant must overflow the column`);
        await mutant.evaluate((el) => el.remove());
      }

      if (width === 390 && column === 308) {
        // Interaction (portal#1829): select an integration with the keyboard, Tab
        // to Configure, press Enter; the click must reach `onconfigure` once.
        // Configure is disabled until something is selected, so Tab from the
        // select must skip it first.
        await page.evaluate(() => { window.__configured = 0; });
        await page.focus('#addIntegration');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY', `${label}: Configure took focus while disabled`);
        await page.focus('#addIntegration');
        await page.selectOption('#addIntegration', 'exchange');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Configure', `${label}: Tab from the select does not reach Configure`);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.__configured), 1, `${label}: Enter on Configure did not call onconfigure exactly once`);
      }
      console.log(JSON.stringify({ width, column, dark, scrollWidth: got.scrollWidth, rects: got.rects }));
      await page.close();
    }
  }

  // The hasGithubConfigured variant (portal#1829): GitHub is no longer offered
  // once configured, only Exchange, and the row still fits the narrowest column.
  for (const [hasGithubConfigured, expected] of [[false, ['', 'github', 'exchange']], [true, ['', 'exchange']]]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
    await page.goto(new URL('/@vite/client', origin).href);
    await page.evaluate((css) => { document.head.innerHTML = ''; document.body.innerHTML = `<style>${css}</style><main id="col"></main>`; }, css);
    await page.addStyleTag({ content: '#col { width: 238px; margin: 0 auto; }' });
    await page.evaluate(async (hasGithubConfigured) => {
      const { mountAddRow } = await import('/src/lib/test/fixtures/add-integration-row-harness.ts');
      mountAddRow(document.getElementById('col'), { hasGithubConfigured });
    }, hasGithubConfigured);
    await page.waitForSelector('#addIntegration');
    const values = await page.$$eval('#addIntegration option', (os) => os.map((o) => o.value));
    assert.deepEqual(values, expected, `hasGithubConfigured=${hasGithubConfigured}: wrong options offered`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320, `hasGithubConfigured=${hasGithubConfigured}: page overflows at 320px`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
