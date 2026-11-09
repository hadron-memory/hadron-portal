// #1867: native pointer hit-testing, not a jsdom stacking-class assertion.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'ai-config-navigation-stub', enforce: 'pre',
  transform(code, id) { return id.endsWith('/AiServiceConfigManager.svelte') ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null; },
}] });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('/src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  if (process.env.AI_CONFIG_MENU_SHOTS) await mkdir(process.env.AI_CONFIG_MENU_SHOTS, { recursive: true });
  for (const dark of [false, true]) for (const enabled of [false, true]) {
    const label = `${dark ? 'dark' : 'light'}-${enabled ? 'enabled' : 'disabled'}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__ai_config_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>AI config row fixture</title>' }));
    await page.route('**/api/ai-configs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) }));
    await page.goto(new URL('/__ai_config_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
      document.head.innerHTML = `<style>${css}</style>`;
      document.documentElement.classList.toggle('dark', dark);
      document.body.innerHTML = `<main class="p-6 ${dark ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-900'}" id="fixture"></main>`;
    }, { css, dark });
    await page.evaluate(async enabled => {
      const { mountAiConfigRows } = await import('/src/lib/test/fixtures/ai-config-row-menu-harness.ts');
      mountAiConfigRows(document.getElementById('fixture'), enabled);
    }, enabled);
    const trigger = page.getByRole('button', { name: 'Actions for config-02', exact: true });
    // Delete replaces the trigger with inline confirmation; bind to the row's stable name.
    const row = page.locator('tbody tr').filter({ hasText: 'config-02' });
    await trigger.click();
    const edit = page.getByRole('menuitem', { name: 'Edit', exact: true });
    await edit.waitFor();
    // Trial uses Chromium's actual pointer hit test without force or a DOM-dispatched click.
    await edit.click({ trial: true, timeout: 2000 });
    if (process.env.AI_CONFIG_MENU_SHOTS) await page.screenshot({ path: `${process.env.AI_CONFIG_MENU_SHOTS}/${label}.png` });
    await edit.click();
    await page.locator('input').filter({ visible: true }).first().waitFor();
    assert.equal(await page.locator('input').evaluateAll(inputs => inputs.some(input => input.value === 'config-02')), true, `${label}: Edit opens this row`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click({ timeout: 2000 });
    await row.getByText('Delete? This cannot be undone.', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await row.getByText('Delete? This cannot be undone.', { exact: true }).count(), 0);
    assert.deepEqual(errors, [], `${label}: no page errors`);
    console.log(`${label} PASS: middle-row Edit and Delete receive native pointer clicks`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
