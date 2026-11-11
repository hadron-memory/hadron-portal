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
  // #1874: `mixed` puts config-02 between adjacent disabled rows and config-04, enabled, right after them.
  const fixtures = [['disabled', [['config-02', false]]], ['enabled', [['config-02', true]]], ['mixed', [['config-02', false], ['config-04', true]]]];
  for (const width of [390, 1280]) for (const dark of [false, true]) for (const [mode, targets] of fixtures) {
    const label = `${width}-${dark ? 'dark' : 'light'}-${mode}`;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
    await page.route('**/__ai_config_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>AI config row fixture</title>' }));
    await page.route('**/api/ai-configs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) }));
    await page.goto(new URL('/__ai_config_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
      document.head.innerHTML = `<style>${css}</style>`;
      document.documentElement.classList.toggle('dark', dark);
      document.body.innerHTML = `<main class="p-6 ${dark ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-900'}" id="fixture"></main>`;
    }, { css, dark });
    if (width === 390) {
      await page.evaluate(() => {
        localStorage.setItem('hadron:views:v1:ai-configs', JSON.stringify([{
          id: 'middle-actions', name: 'Middle actions', isDefault: true, listKey: 'ai-configs',
          view: { columnOrder: ['name', 'actions', 'provider', 'model', 'endpoint', 'enabled', 'key', 'createdAt'], columnSizing: { actions: 500, name: 400 } },
        }]));
      });
    }
    await page.evaluate(async mode => {
      const { mountAiConfigRows } = await import('/src/lib/test/fixtures/ai-config-row-menu-harness.ts');
      mountAiConfigRows(document.getElementById('fixture'), mode);
    }, mode);
    for (const [name, enabled] of targets) {
      const where = `${label}/${name}`;
      const trigger = page.getByRole('button', { name: `Actions for ${name}`, exact: true });
      // Delete replaces the trigger with inline confirmation; bind to the row's stable name.
      const row = page.locator('tbody tr').filter({ hasText: name });
      // Computed opacity, read before any hit test, so missing compiled CSS fails here by name:
      // disabled rows dim their content (0.6), enabled rows don't, and the row itself never does (#1867).
      const dim = await row.getByText(name, { exact: true }).evaluate(el => ({
        content: getComputedStyle(el).opacity,
        ancestors: (() => { const out = []; for (let n = el.parentElement; n; n = n.parentElement) if (getComputedStyle(n).opacity !== '1') out.push(n.tagName); return out; })(),
      }));
      assert.equal(dim.content, enabled ? '1' : '0.6', `${where}: name content opacity`);
      assert.deepEqual(dim.ancestors, [], `${where}: no dimmed ancestor of the row content`);
      if (width === 390) {
        assert.match((await page.locator('th').allTextContents())[1], /Actions/, 'Saved order applied');
        const scroller = page.getByTestId('data-table-scroller');
        await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const [viewport, action] = await Promise.all([scroller.boundingBox(), trigger.boundingBox()]);
        assert(viewport && action && action.x >= viewport.x && action.x + action.width <= viewport.x + viewport.width, `${where}: reordered Actions remains inside scroller at far right`);
      }
      await trigger.click();
      const edit = page.getByRole('menuitem', { name: 'Edit', exact: true });
      await edit.waitFor();
      const menuDimmed = await edit.evaluate(el => { const out = []; for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).opacity !== '1') out.push(n.tagName); return out; });
      assert.deepEqual(menuDimmed, [], `${where}: no opacity on the menu or any ancestor`);
      // Trial uses Chromium's actual pointer hit test without force or a DOM-dispatched click.
      await edit.click({ trial: true, timeout: 2000 });
      if (process.env.AI_CONFIG_MENU_SHOTS) await page.screenshot({ path: `${process.env.AI_CONFIG_MENU_SHOTS}/${label}-${name}.png` });
      await edit.click();
      // The editor's own name field, not the first visible input (the grid's search box already is one).
      const nameInput = page.locator('#ac-name');
      await nameInput.waitFor({ timeout: 2000 });
      assert.equal(await nameInput.inputValue(), name, `${where}: Edit opens this row`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await nameInput.waitFor({ state: 'detached', timeout: 2000 });
      if (width === 390) {
        assert.match((await page.locator('th').allTextContents())[1], /Actions/, 'Saved order applied');
        const scroller = page.getByTestId('data-table-scroller');
        await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const [viewport, action] = await Promise.all([scroller.boundingBox(), trigger.boundingBox()]);
        assert(viewport && action && action.x >= viewport.x && action.x + action.width <= viewport.x + viewport.width, `${where}: reordered Actions remains inside scroller at far right`);
      }
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click({ timeout: 2000 });
      await row.getByText(`Delete the “${name}” configuration? This cannot be undone.`, { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await row.getByText(`Delete the “${name}” configuration? This cannot be undone.`, { exact: true }).count(), 0, `${where}: Delete confirmation cancels`);
      console.log(`${where} PASS: Edit and Delete receive native pointer clicks; opacity on content only`);
    }
    assert.deepEqual(errors, [], `${label}: no page errors or console errors`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
