// Real Chromium geometry/focus pins; synthetic component fixture, not signed-in/server QA.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'memory-config-navigation-stub', enforce: 'pre', transform(code, id) { return /memory-config\/.*\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null; } }] });
let browser;
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 for (const width of [320, 390, 1280]) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  await page.route('**/__blank', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fixture</title>' }));
  let writes = 0;
  await page.route('**/api/memory-config', r => { writes++; return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CONFLICT', error: 'Fixture revision changed.' }) }); });
  await page.goto(new URL('/__blank', origin).href);
  await page.evaluate(({ css, dark }) => { document.head.innerHTML = `<style>${css}</style>`; document.body.innerHTML = '<main style="max-width:1100px;margin:16px" id="fixture"></main>'; document.documentElement.classList.toggle('dark', dark); }, { css, dark });
  await page.evaluate(async () => { const { mountTemplates } = await import('/src/lib/test/fixtures/memory-config-layout-harness.ts'); mountTemplates(document.getElementById('fixture')); });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('heading', { name: 'Edit template', exact: true }).waitFor();
  await page.locator('fieldset').getByTestId('table-header-toggle').click();
  await page.getByRole('textbox', { name: 'Search rules…', exact: true }).press('Enter');
  await page.waitForTimeout(50);
  assert.equal(writes, 0, 'Search Enter must not save a template draft');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `${width}/${dark}: template editor overflows ${overflow}px`);
  await page.locator('fieldset').getByTestId('table-header-hide').click();
  const editor = page.locator('[aria-label="Template editor"]');
  await editor.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForTimeout(50);
  assert.equal(writes, 0, 'Pagination must not save a template draft');
  await editor.getByRole('button', { name: 'Previous', exact: true }).click();
  const edit = editor.getByRole('button', { name: 'Edit', exact: true }).first();
  await edit.click();
  const ruleDialog = page.getByRole('dialog', { name: 'Edit rule', exact: true });
  await ruleDialog.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
  await ruleDialog.getByRole('button', { name: 'Change…', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Choose a node', exact: true }).waitFor();
  // No evaluate/count/waitFor between keys: Playwright evaluation can grant a user gesture
  // and hide Chromium's second, non-cancelable native close request.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await ruleDialog.waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Choose a node', exact: true }).count(), 0, 'Only reference picker closes');
  assert.equal(await ruleDialog.getByRole('checkbox', { name: 'Enabled', exact: true }).isChecked(), false, 'Backing out of picker retains rule draft');
  await ruleDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Edit');
  assert.equal(await edit.evaluate(el => document.activeElement === el), true, 'Return to invoking draft row');
  await page.locator('[aria-label="Template editor"]').getByRole('button', { name: 'Save', exact: true }).click();
  const alert = page.getByRole('alert'); await alert.waitFor();
  const gap = await page.evaluate(() => { const a = document.querySelector('[role=alert]').getBoundingClientRect(); const save = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Save').getBoundingClientRect(); return save.top - a.bottom; });
  assert.ok(gap >= 0 && gap < 160, `Refusal near Save: ${gap}px`);
  if (process.env.MEMORY_CONFIG_SHOTS) await page.screenshot({ path: `${process.env.MEMORY_CONFIG_SHOTS}/${width}-${dark ? 'dark' : 'light'}-template-refusal.png`, fullPage: true });
  console.log(`${width}/${dark ? 'dark' : 'light'} PASS: no overflow, focus return, nearby refusal`);
  await page.close();
 }
} finally { await browser?.close(); await server.close(); }
