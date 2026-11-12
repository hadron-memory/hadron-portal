// Native dialog close-watcher behavior needs real Chromium: jsdom cannot reproduce repeated Escape.
// Synthetic component fixture and controlled requests only; no live server or signed-in claim.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'memory-config-navigation-stub', enforce: 'pre', transform(code, id) { return /memory-config\/.*\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null; } }] });
let browser;
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 for (const width of [390, 1280]) for (const dark of [false, true]) for (const held of ['save', 'reload']) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(10000);
  await page.route('**/__blank', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>pending escape fixture</title>' }));
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { received = resolve; });
  let writes = 0;
  await page.route('**/api/memory-config', async route => {
   const input = route.request().postDataJSON();
   if (input.op === 'update') {
    writes++;
    if (held === 'save') { received(); await gate; await route.fulfill({ status: 409, json: { code: 'CONFLICT', error: 'Held save refused.' } }); }
    else await route.fulfill({ json: {} });
   } else if (input.op === 'read') {
    received(); await gate;
    await route.fulfill({ status: 500, json: { error: 'Held reload unavailable.' } });
   } else throw new Error(`Unexpected operation: ${input.op}`);
  });
  try {
   await page.goto(new URL('/__blank', origin).href);
   await page.evaluate(({ css, dark }) => { document.head.innerHTML = `<style>${css}</style>`; document.body.innerHTML = '<main style="margin:16px" id="fixture"></main>'; document.documentElement.classList.toggle('dark', dark); }, { css, dark });
   await page.evaluate(async () => { const { mountRulebook } = await import('/src/lib/test/fixtures/memory-config-layout-harness.ts'); mountRulebook(document.getElementById('fixture')); });
   await page.getByRole('button', { name: 'Edit', exact: true }).click();
   const dialog = page.getByRole('dialog', { name: 'Edit rule', exact: true });
   const enabled = dialog.getByRole('checkbox', { name: 'Enabled', exact: true }); await enabled.uncheck();
   await dialog.getByRole('button', { name: 'Save', exact: true }).click();
   let timer;
   await new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Expected held request was not reached')), 10000); started.then(resolve, reject); }).finally(() => clearTimeout(timer));
   // Repeated Escape has no intervening user activation. Test body focus as well as dialog focus.
   await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
   for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
   assert.equal(await page.locator('dialog').evaluate(el => el.open), true, `${width}/${dark}/${held}: pending dialog must stay open after rapid Escape`);
   await page.locator('dialog').evaluate(el => { el.tabIndex = -1; el.focus(); });
   assert.equal(await page.locator('dialog').evaluate(el => document.activeElement === el), true, 'Inside-dialog key target reached');
   for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
   assert.equal(await page.locator('dialog').evaluate(el => el.open), true, `${width}/${dark}/${held}: pending dialog must stay open after spaced Escape`);
   release();
   if (held === 'save') {
    await dialog.getByRole('alert').filter({ hasText: 'Held save refused.' }).waitFor();
    assert.equal(await enabled.isChecked(), false, 'Refused save retains the draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit rule', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Edit rule', exact: true }).waitFor({ state: 'detached' });
   } else {
    await page.locator('[data-rule-feedback-visual]').filter({ hasText: 'Saved, but the rules could not be reloaded.' }).waitFor();
    assert.equal(await page.locator('dialog').count(), 0, 'Successful save closes only after reload settles');
    await page.getByRole('button', { name: 'Create rule', exact: true }).click(); await page.getByRole('dialog', { name: 'Create rule', exact: true }).waitFor();
   }
   assert.equal(writes, 1, 'Never replay the pending mutation');
   console.log(`${width}/${dark ? 'dark' : 'light'}/${held}: PASS repeated Escape, visible settled outcome, one write and usable editor`);
  } finally { release(); await page.close(); }
 }
} finally { await browser?.close(); await server.close(); }
