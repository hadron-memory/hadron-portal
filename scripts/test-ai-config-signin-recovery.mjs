// Native navigation/layout fixture only. Full authenticated identity acceptance
// is independently owed on a disposable stack; this does not simulate its guards.
import assert from 'node:assert/strict';
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
  for (const touch of [false, true]) for (const dark of [false, true]) {
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1280, height: 900 }, hasTouch: touch, isMobile: touch });
    let writes = 0;
    let refuse = true;
    let freshUser = 'fixture-user';
    await context.route('**/api/ai-configs?principal=1', route => route.fulfill({ json: { principal: { principalType: 'USER', userId: freshUser, appId: null } } }));
    await context.route('**/api/ai-configs', route => {
      const action = route.request().postDataJSON().action;
      if (action === 'endpoints') return route.fulfill({ json: { endpoints: [] } });
      writes++;
      return route.fulfill({ status: refuse ? 401 : 200, json: refuse ? { error: 'Unauthorized' } : { ok: true } });
    });
    await context.route('**/__ai_recovery_fixture*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic AI editor</title><main id="fixture"></main>' }));
    await context.route('**/signin?*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic sign-in destination</title><p>No credentials or draft transferred.</p>' }));
    const page = await context.newPage();
    await page.goto(new URL('/__ai_recovery_fixture?discard=query#discard-fragment', origin).href);
    await page.evaluate(async ({ css, dark }) => {
      const style = document.createElement('style'); style.textContent = css; document.head.append(style);
      document.documentElement.classList.toggle('dark', dark);
      document.body.className = dark ? 'bg-zinc-950 text-white p-6' : 'bg-white text-zinc-900 p-6';
      const { mountAiConfigRows } = await import('/src/lib/test/fixtures/ai-config-row-menu-harness.ts');
      mountAiConfigRows(document.getElementById('fixture'), 'enabled');
    }, { css, dark });
    const add = page.getByRole('button', { name: 'Add configuration', exact: true });
    if (touch) await add.tap(); else await add.click();
    await page.locator('#ac-name').fill('recovery-check');
    await page.locator('#ac-model').fill('synthetic-model');
    // In-memory synthetic value; no screenshots, trace, HAR or request-body log.
    await page.locator('#ac-key').fill('synthetic-unused-key');
    const model = await page.locator('#ac-model').elementHandle();
    const region = await page.getByTestId('ai-config-error-feedback').elementHandle();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    if (touch) await save.tap(); else { await save.focus(); await page.keyboard.press('Enter'); }
    const link = page.getByRole('link', { name: 'Sign in (opens in a new tab)', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), '/signin?redirect=%2F__ai_recovery_fixture');
    assert.equal(await region.evaluate(el => el.isConnected && el.getAttribute('role') === 'alert'), true);
    assert.equal(await model.evaluate(el => el.isConnected), true);
    assert.equal(writes, 1);
    const box = await link.boundingBox();
    assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= (touch ? 390 : 1280));
    if (touch) assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    await link.focus();
    assert.equal(await link.evaluate(el => document.activeElement === el), true);
    const popupWait = context.waitForEvent('page');
    if (touch) await link.tap(); else await page.keyboard.press('Enter');
    const popup = await popupWait;
    await popup.waitForLoadState();
    assert.equal(await popup.evaluate(() => window.opener), null);
    assert.equal(new URL(popup.url()).searchParams.get('redirect'), '/__ai_recovery_fixture');
    assert.equal(await popup.locator('#ac-key').count(), 0);
    assert.equal(await popup.evaluate(() => localStorage.length + sessionStorage.length), await page.evaluate(() => localStorage.length + sessionStorage.length));
    await popup.close(); await page.bringToFront();
    assert.equal(await model.evaluate(el => el.isConnected), true);
    assert.equal(await page.locator('#ac-key').inputValue(), 'synthetic-unused-key');
    assert.equal(writes, 1, 'Closing the other tab never replays');
    refuse = false;
    if (touch) await save.tap(); else { await save.focus(); await page.keyboard.press('Enter'); }
    await page.locator('#ac-model').waitFor({ state: 'detached' });
    assert.equal(writes, 2, 'Only explicit retry writes again');
    // A fresh identity read, not the unchanged mounted props, fences retry.
    if (touch) await add.tap(); else await add.click();
    await page.locator('#ac-name').fill('second-draft');
    await page.locator('#ac-model').fill('synthetic-model');
    await page.locator('#ac-key').fill('synthetic-unused-key');
    freshUser = 'different-fixture-user';
    if (touch) await save.tap(); else { await save.focus(); await page.keyboard.press('Enter'); }
    await page.getByText('Your sign-in or selected context changed. The draft was discarded.', { exact: true }).waitFor();
    assert.equal(await page.locator('#ac-key').count(), 0);
    assert.equal(writes, 2, 'Different fresh user never receives the old draft write');
    console.log(`${touch ? '390 coarse' : '1280 keyboard'} ${dark ? 'dark' : 'light'}: native noopener tab, retained original editor, close, explicit retry and changed-user refusal PASS (fixture only)`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
