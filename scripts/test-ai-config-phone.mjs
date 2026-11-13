// Author browser check on a disposable E2E stack only; no provider calls.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { assertDisposableStack, withSyntheticConfig } from './lib/ai-config-browser.mjs';
import { chromium } from 'playwright';
const { portal, api } = await assertDisposableStack(process.env);
if (process.env.AI_CONFIG_TEST_SHOTS)
    await mkdir(process.env.AI_CONFIG_TEST_SHOTS, { recursive: true });
const ownerId = createHash('sha256').update('hadron-e2e:e2e-alpha').digest('hex').slice(0, 32);
// This script runs against Vite dev. Client metadata is absent on SSR-only DOM;
// wait on the exact connected control before activation, then on its own state.
async function hydratedControl(page, locator) {
    const handle = await locator.elementHandle();
    assert(handle);
    await page.waitForFunction(el => el.isConnected && '__svelte_meta' in el, handle);
    return handle;
}
const browser = await chromium.launch({ headless: true });
try {
    // Independent contexts: widening a mobile page does not make its pointer fine.
    for (const desktop of [false, true]) {
        const context = await browser.newContext({ viewport: { width: desktop ? 1280 : 390, height: 1000 }, hasTouch: !desktop, isMobile: !desktop });
        try {
            const page = await context.newPage();
            const activate = locator => desktop ? locator.click() : locator.tap();
            await page.goto(`${api}/auth/dev/login?email=alpha-admin@e2e.test&redirect=/app/dashboard`);
            await page.waitForURL(`${portal}/app/**`);
            assert(await page.evaluate(desktop => matchMedia(desktop ? '(pointer: fine)' : '(pointer: coarse)').matches, desktop), 'Actual pointer mode must match context');
            const fixtureName = `phone-check-${randomUUID()}`;
            await withSyntheticConfig(page.request, portal, { ownerType: 'ORGANIZATION', ownerId, name: fixtureName, provider: 'glm', model: 'glm-5' }, async () => {
                // Regression switch: fail after creation so finally must remove this run's fixture.
                if (process.env.AI_CONFIG_TEST_FAIL_AFTER_SETUP === '1')
                    throw new Error('Injected synthetic probe failure');
                for (const theme of ['light', 'dark']) {
                    await page.goto(`${portal}/app/orgs/${ownerId}/integrations`);
                    await page.getByRole('button', { name: 'Add configuration', exact: true }).waitFor();
                    const themeButton = page.getByRole('button', { name: 'Theme', exact: true });
                    const themeHandle = await hydratedControl(page, themeButton);
                    await activate(themeButton);
                    await page.waitForFunction(el => el.isConnected && el.getAttribute('aria-expanded') === 'true', themeHandle);
                    await activate(page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }));
                    await page.waitForFunction(theme => document.documentElement.classList.contains('dark') === (theme === 'dark'), theme);
                    const addBox = await page.getByRole('button', { name: 'Add configuration', exact: true }).boundingBox();
                    assert(addBox && addBox.x >= 0 && addBox.x + addBox.width <= (desktop ? 1280 : 390), 'Add configuration must remain on-screen with touch owner controls');
                    const action = page.getByRole('button', { name: `Actions for ${fixtureName}`, exact: true });
                    await action.waitFor();
                    // Desktop retains a deliberately scrollable multi-column table; phone
                    // controls must be visible without this scroll-into-view accommodation.
                    if (desktop)
                        await action.scrollIntoViewIfNeeded();
                    const box = await action.boundingBox();
                    assert(box && box.x >= 0 && box.x + box.width <= (desktop ? 1280 : 390), `${theme}: Actions must be visible in ${desktop ? "fine desktop" : "coarse phone"}; x=${box?.x}`);
                    await activate(page.getByRole('heading', { name: 'Integrations', exact: true }));
                    await activate(action);
                    await activate(page.getByRole('menuitem', { name: 'Delete', exact: true }));
                    const confirm = page.getByRole('button', { name: 'Delete', exact: true });
                    await confirm.waitFor();
                    await page.getByText(`Delete the “${fixtureName}” configuration? This cannot be undone.`, { exact: true }).waitFor();
                    const confirmBox = await confirm.boundingBox();
                    assert(confirmBox && confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= (desktop ? 1280 : 390), 'Confirm must remain on-screen');
                    if (process.env.AI_CONFIG_TEST_SHOTS)
                        await page.screenshot({ path: `${process.env.AI_CONFIG_TEST_SHOTS}/${theme}-${desktop ? 'fine-1280' : 'coarse-390'}.png`, fullPage: false });
                    await activate(page.getByRole('button', { name: 'Cancel', exact: true }));
                    assert(await action.isVisible(), 'Cancel must restore the row actions');
                    console.log(`${theme}: ${desktop ? "fine desktop" : "coarse phone"} action + named confirmation + cancel PASS`);
                }
                // Restore a deliberately wide saved action column and a non-default order.
                await page.evaluate(() => {
                    localStorage.setItem('hadron:views:v1:ai-configs', JSON.stringify([{
                            id: 'wide-actions', name: 'Wide actions', isDefault: true, listKey: 'ai-configs',
                            view: { columnOrder: ['name', 'actions', 'provider', 'model', 'endpoint', 'enabled', 'key', 'createdAt'], columnSizing: { actions: 500, name: 400 } },
                        }]));
                    localStorage.setItem('hadron:views:v1:active:ai-configs', 'wide-actions');
                });
                for (const width of (desktop ? [1280] : [320, 390])) {
                    await page.setViewportSize({ width, height: 1000 });
                    await page.reload();
                    await page.getByRole('button', { name: 'Add configuration', exact: true }).waitFor();
                    await page.getByText('Wide actions', { exact: true }).waitFor({ state: 'attached' });
                    const header = page.getByRole('columnheader', { name: /^Actions/ });
                    const headerHandle = await header.elementHandle();
                    assert(headerHandle);
                    await page.waitForFunction(({ el, width }) => el.isConnected && Math.abs(el.getBoundingClientRect().width - width) < 2, { el: headerHandle, width: width < 640 ? 170 : 500 });
                    const size = await header.evaluate(e => e.getBoundingClientRect().width);
                    assert(Math.abs(size - (width < 640 ? 170 : 500)) < 2, `Restored action width at ${width}: ${size}`);
                    const action = page.getByRole('button', { name: `Actions for ${fixtureName}`, exact: true });
                    if (width < 640) {
                        const box = await action.boundingBox();
                        assert(box && box.x >= 0 && box.x + box.width <= width, `Restored Actions clipped at ${width}`);
                        const actionHandle = await hydratedControl(page, action);
                        await action.focus();
                        await page.keyboard.press('Enter');
                        await page.waitForFunction(el => el.isConnected && el.getAttribute('aria-expanded') === 'true', actionHandle);
                        await page.getByRole('menuitem', { name: 'Delete', exact: true }).waitFor();
                        await page.keyboard.press('Escape');
                        assert(await action.evaluate(e => document.activeElement === e), 'Escape returns focus');
                    }
                    console.log(`saved width/order at ${width}: PASS`);
                }
            });
        }
        finally {
            await context.close();
        }
    }
}
finally {
    await browser.close();
}
