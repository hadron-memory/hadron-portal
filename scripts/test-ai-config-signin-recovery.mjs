// Native navigation/layout fixture only. Full authenticated identity acceptance
// is independently owed on a disposable stack; this does not simulate its guards.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Storage is checked by keys and getItem values. localStorage is shared per
// origin; sessionStorage must be checked independently for each tab.
async function storedEntries(page) {
  return page.evaluate(() => {
    const entries = store => Array.from({ length: store.length }, (_, index) => {
      const key = store.key(index);
      return [key, store.getItem(key)];
    });
    return { local: entries(localStorage), session: entries(sessionStorage) };
  });
}
function assertNoDraftStorage(stores) {
  for (const entries of [stores.local, stores.session]) for (const marker of ['synthetic-unused-key', 'recovery-check', 'synthetic-model']) {
    assert(!JSON.stringify(entries).includes(marker), 'Draft/key must stay in component memory');
  }
}

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
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1280, height: touch ? 740 : 900 }, hasTouch: touch, isMobile: touch });
    let writes = 0;
    let refuse = true;
    let freshUser = 'fixture-user';
    const identityAnswers = [];
    await context.route('**/api/ai-configs/principal', route => { identityAnswers.push(freshUser === 'fixture-user' ? 'original' : 'different'); return route.fulfill({ json: { principal: { principalType: 'USER', userId: freshUser, appId: null } } }); });
    await context.route('**/api/ai-configs', route => {
      const action = route.request().postDataJSON().action;
      if (action === 'endpoints') return route.fulfill({ json: { endpoints: [] } });
      writes++;
      return route.fulfill({ status: refuse ? 401 : 200, json: refuse ? { error: 'Unauthorized' } : { ok: true } });
    });
    await context.route('**/__ai_recovery_fixture*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic AI editor</title><main id="fixture"></main>' }));
    await context.route('**/signin?*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic sign-in destination</title><p>No credentials or draft transferred.</p>' }));
    const page = await context.newPage();
    await page.goto(new URL('/__ai_recovery_fixture?discard=query#discard-fragment', origin).href);
    assert.equal(await page.evaluate(() => document.documentElement.clientWidth), touch ? 390 : 1280, 'Fixture uses the intended CSS layout viewport');
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
    async function activateSave() {
      // focus() alone does not wait for a disabled button. Without readiness,
      // Enter can hit the previous field while the identity read is pending.
      await save.click({ trial: true });
      if (touch) await save.tap();
      else {
        await save.focus();
        assert.equal(await save.evaluate(el => document.activeElement === el), true);
        await page.keyboard.press('Enter');
      }
    }
    await activateSave();
    const link = page.getByRole('link', { name: 'Sign in (opens in a new tab)', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), '/signin?redirect=%2F__ai_recovery_fixture');
    assert.equal(await region.evaluate(el => el.isConnected && el.getAttribute('role') === 'alert'), true);
    assert.equal(await model.evaluate(el => el.isConnected), true);
    assert.equal(writes, 1);
    const box = await link.boundingBox();
    assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= (touch ? 390 : 1280));
    if (touch) assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    // No scripted focus: recovery must hand real keyboard/touch attention here.
    await page.waitForFunction(() => document.activeElement?.getAttribute('href')?.startsWith('/signin?'), null, { timeout: 5000 });
    const alertBox = await page.getByTestId('ai-config-error-feedback').boundingBox();
    assert(alertBox && alertBox.y >= 0 && alertBox.y + alertBox.height <= (touch ? 740 : 900), 'Recovery alert is in the actual viewport without a manual scroll');
    assert.equal(await link.evaluate(el => document.activeElement === el), true);
    assertNoDraftStorage(await storedEntries(page));
    await page.evaluate(() => sessionStorage.setItem('opener-only', 'nonsecret-opener-probe'));
    const popupWait = context.waitForEvent('page');
    if (touch) await link.tap(); else await page.keyboard.press('Enter');
    const popup = await popupWait;
    await popup.waitForLoadState();
    assert.equal(await popup.evaluate(() => window.opener), null);
    assert.equal(new URL(popup.url()).searchParams.get('redirect'), '/__ai_recovery_fixture');
    assert.equal(await popup.locator('#ac-key').count(), 0);
    const popupStores = await storedEntries(popup);
    assertNoDraftStorage(popupStores);
    assertNoDraftStorage(await storedEntries(page));
    assert(!JSON.stringify(popupStores.session).includes('nonsecret-opener-probe'), 'No opener sessionStorage clone into the new tab');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('opener-only')), 'nonsecret-opener-probe');
    await popup.close(); await page.bringToFront();
    assert.equal(await model.evaluate(el => el.isConnected), true);
    assert.equal(await page.locator('#ac-key').inputValue(), 'synthetic-unused-key');
    assert.equal(writes, 1, 'Closing the other tab never replays');
    refuse = false;
    await activateSave();
    await page.locator('#ac-model').waitFor({ state: 'detached' });
    assert.equal(writes, 2, 'Only explicit retry writes again');
    // A fresh identity read, not the unchanged mounted props, fences retry.
    if (touch) await add.tap(); else await add.click();
    await page.locator('#ac-name').fill('second-draft');
    await page.locator('#ac-model').fill('synthetic-model');
    await page.locator('#ac-key').fill('synthetic-unused-key');
    // Confirm the initial original-user read has settled before replacing the
    // simulated cookie identity. Trial waits for the enabled original control.
    await save.click({ trial: true });
    if (!touch) {
      await save.focus();
      assert.equal(await save.evaluate(el => document.activeElement === el), true);
    }
    freshUser = 'different-fixture-user';
    if (touch) await save.tap(); else await page.keyboard.press('Enter');
    try { await page.getByText('Your sign-in or the selected organization or app changed, so your draft was discarded. Open the form again to start over.', { exact: true }).waitFor({ timeout: 5000 }); }
    catch (error) {
      console.log(JSON.stringify({ touch, dark, writes, identityAnswers, alert: await page.getByTestId('ai-config-error-feedback').textContent(), editorPresent: await page.locator('#ac-key').count() }));
      throw error;
    }
    assert.equal(await page.locator('#ac-key').count(), 0);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'ai-config-error-feedback', null, { timeout: 5000 });
    assert.equal(writes, 2, 'Different fresh user never receives the old draft write');
    console.log(`${touch ? '390 coarse' : '1280 keyboard'} ${dark ? 'dark' : 'light'}: native noopener tab, retained original editor, close, explicit retry and changed-user refusal PASS (fixture only)`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
