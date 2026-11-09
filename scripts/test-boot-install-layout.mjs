// Real Chromium, synthetic provider responses. No sign-in, server writes or independent QA claim.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = process.env.BOOT_INSTALL_SHOTS;
if (output) await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const variant of ['app', 'worker', 'source', 'failed']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.route('**/__blank1666', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Boot prompt layout</title>' }));
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(new URL('/__blank1666', origin).href);
        await page.evaluate(({ css, width, theme }) => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          document.body.innerHTML = `<style>${css}</style><main id="col" style="max-width:${width === 390 ? 342 : 1000}px;margin:24px auto"></main>`;
          document.body.style.background = theme === 'dark' ? '#09090b' : '#fafafa';
        }, { css, width, theme });
        await page.evaluate(async variant => { const { mountBootInstall } = await import('/src/lib/test/fixtures/boot-install-harness.ts'); mountBootInstall(document.getElementById('col'), variant); }, variant);
        await page.getByRole('button', { name: 'Update the prompt', exact: true }).waitFor();
        break;
      } catch (e) { if (attempt >= 5 || !/Execution context was destroyed|navigation/i.test(String(e))) throw e; }
    }
    if (variant === 'source') await page.getByRole('button', { name: 'Start an empty source for this worker', exact: true }).click();
    else if (variant === 'failed') await page.getByRole('alert').filter({ hasText: 'Couldn’t load what this revision was built from' }).waitFor();
    else await page.getByText('Not available to you', { exact: true }).waitFor();
    if (width === 1280 && (variant === 'app' || variant === 'worker')) {
      for (const label of ['Depth', 'Revision']) {
        const header = page.getByRole('columnheader').filter({ hasText: label });
        const metrics = await header.locator('.truncate').evaluate(el => ({ visible: el.clientWidth, required: el.scrollWidth }));
        assert.ok(metrics.visible >= metrics.required, `${variant}/${theme}/${width}: ${label} header truncated (${metrics.visible}/${metrics.required})`);
      }
    }
    if (variant === 'app') {
      await page.getByRole('button', { name: 'Update the prompt', exact: true }).click();
      await page.getByRole('region', { name: 'Confirm App prompt update' }).waitFor();
      if (output) await page.screenshot({ path: `${output}/app-confirm-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Build and point App', exact: true }).click();
    } else if (variant === 'worker') await page.getByRole('button', { name: 'Update the prompt', exact: true }).click();
    if (variant === 'app' || variant === 'worker') {
      const outcome = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm whether the prompt was built' });
      await outcome.waitFor();
      assert.ok(await outcome.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('section[aria-label="Built from"]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }
    const measured = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, html: document.body.innerHTML }));
    assert.equal(measured.scroll, measured.width, `${variant}/${theme}/${width}: horizontal page overflow`);
    assert.ok(!measured.html.includes('private-node-id'));
    if (output) await page.screenshot({ path: `${output}/${variant}-${theme}-${width}.png`, fullPage: true });
    await page.close();
  }
  console.log('PASS: 16 real-component Chromium layouts (390/1280, light/dark; synthetic transport only)');
} finally { await browser?.close(); await server.close(); }
