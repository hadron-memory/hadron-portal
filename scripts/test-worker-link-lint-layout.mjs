// Author rendered evidence: real editor + synthetic reads/Kit stores, no provider or saved-write claim.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
const output = process.env.WORKER_LINK_SHOTS;
if (output) await mkdir(output, { recursive: true });
const alias = { $lib: resolve('src/lib') };
for (const name of ['forms', 'stores', 'navigation', 'environment', 'state']) alias[`$app/${name}`] = resolve(`src/lib/test/stubs/app-${name}.ts`);
const server = await createServer({ configFile: false, optimizeDeps: { exclude: ['sveltekit-superforms'] }, plugins: [tailwindcss(), svelte()], resolve: { alias, conditions: ['browser'] }, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const variant of ['both', 'signature', 'trailer', 'zero', 'unavailable', 'partial', 'unknown', 'masked']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/__blank1685', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Saved worker link advice</title>' }));
    await page.goto(new URL('/__blank1685', origin).href);
    await page.evaluate(({ css, width, theme }) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.body.innerHTML = `<style>${css}</style><main id="col" style="width:${width === 390 ? 342 : 1000}px;margin:24px auto"></main>`;
      document.body.style.background = theme === 'dark' ? '#09090b' : '#fafafa';
    }, { css, width, theme });
    await page.evaluate(async variant => { const h = await import('/src/lib/test/fixtures/worker-link-lint-harness.ts'); h.mountWorkerLinkLint(document.getElementById('col'), variant); }, variant);
    if (variant === 'masked') {
      await page.getByText('Not shown.', { exact: true }).waitFor();
      assert.equal(await page.locator('form').count(), 0);
      assert.equal(await page.evaluate(async () => (await import('/src/lib/test/fixtures/worker-link-lint-harness.ts')).lintCalls()), 0);
    } else {
      await page.waitForFunction(() => !document.body.textContent.includes('Checking the saved worker link'));
      if (variant === 'unavailable') await page.getByText('Couldn’t check the worker link.', { exact: true }).waitFor();
      if (variant === 'partial') await page.getByText('2 of 3 saved-value checks shown. The rest isn’t shown.', { exact: true }).waitFor();
      await page.locator('textarea[name=signature]').fill('Edited draft');
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), variant === 'unavailable' ? 1 : 0);
      if (variant === 'unavailable') {
        await page.evaluate(() => {
          window.fetch = () => new Promise(resolve => { window.__finishLintRetry = () => resolve(Response.json({ workerId: 'a', page: null })); });
        });
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-signature-lint]')?.getAttribute('aria-busy') === 'true');
        const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, retry: document.activeElement?.textContent === 'Retry' }));
        assert.equal(focused.retry, true, `pending Retry lost focus: ${JSON.stringify(focused)}`);
        await page.evaluate(() => window.__finishLintRetry());
        await page.waitForFunction(() => document.querySelector('[data-signature-lint]')?.getAttribute('aria-busy') === 'false');
      }

    }
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(size.width, size.scroll, `${variant}/${theme}/${width} overflows`);
    if (output) await page.screenshot({ path: `${output}/${variant}-${theme}-${width}.png`, fullPage: true });
    await page.close();
  }
  console.log('PASS: 32 real-editor Chromium layouts, synthetic reads/Kit stores only');
} finally { await browser?.close(); await server.close(); }
