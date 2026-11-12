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
  for (const width of [375, 390, 1280]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.goto(new URL('/@vite/client', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="app"></main>`;
        document.documentElement.classList.toggle('dark', dark);
      }, { css, dark });
      await page.evaluate(async () => {
        const { mountSelectApp } = await import('/src/lib/test/fixtures/select-app-harness.ts');
        mountSelectApp(document.getElementById('app'));
      });
      // #1605: the row's Select is named after its App.
      const select = page.getByRole('button', { name: 'Select A long existing App name for a narrow viewport', exact: true });
      await select.waitFor();
      const measure = () => select.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
      });
      const box = await measure();
      assert.ok(box.left >= 0 && box.right <= box.viewport, `${width}/${dark}: Select off-screen: ${JSON.stringify(box)}`);
      if (width === 390) {
        // A forced-wide grid must make the action unreachable, proving the
        // geometry assertion observes the original defect class.
        const mutant = await page.addStyleTag({ content: '[role="dialog"] table { width: 700px !important; min-width: 700px !important; }' });
        assert.ok((await measure()).right > width, 'wide-grid control must move Select off-screen');
        await mutant.evaluate((el) => el.remove());
        assert.ok((await measure()).right <= width);
      }
      console.log(JSON.stringify({ width, dark, ...box }));
      await page.close();
    }
  }
} finally {
  await browser?.close(); await server.close();
}
