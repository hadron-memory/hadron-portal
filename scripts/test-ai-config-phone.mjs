// Author browser check on a disposable E2E stack only; no provider calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const portal = process.env.AI_CONFIG_TEST_PORTAL;
const api = process.env.AI_CONFIG_TEST_API;
assert(portal && api, 'Set AI_CONFIG_TEST_PORTAL and AI_CONFIG_TEST_API to the disposable stack');
for (const url of [portal, api]) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Loopback only');
const ownerId = createHash('sha256').update('hadron-e2e:e2e-alpha').digest('hex').slice(0, 32);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(`${api}/auth/dev/login?email=alpha-admin@e2e.test&redirect=/app/dashboard`);
  await page.waitForURL('**/app/**');
  const seeded = await page.request.post(`${portal}/api/ai-configs`, { data: {
    action: 'create', ownerType: 'ORGANIZATION', ownerId, name: 'phone-check',
    provider: 'glm', model: 'glm-5', apiKey: 'synthetic-unused-key',
  } });
  assert([200, 409].includes(seeded.status()), 'Synthetic config setup failed');
  for (const theme of ['light', 'dark']) {
    await page.goto(`${portal}/app/orgs/${ownerId}/integrations`);
    await page.evaluate(theme => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem('theme', theme);
    }, theme);
    await page.waitForLoadState('networkidle');
    const action = page.getByRole('button', { name: 'Actions for phone-check', exact: true });
    await action.waitFor();
    const box = await action.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390, `${theme}: Actions must be visible at 390px; x=${box?.x}`);
    await page.touchscreen.tap(2, 2);
    assert(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'Phone uses coarse pointer');
    await action.tap();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).tap();
    const confirm = page.getByRole('button', { name: 'Delete', exact: true });
    await confirm.waitFor();
    const question = await confirm.evaluate(el => el.parentElement.textContent);
    assert(question.includes('phone-check') && question.includes('cannot be undone'), 'Visible confirmation must name the config');
    const confirmBox = await confirm.boundingBox();
    assert(confirmBox && confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= 390, 'Confirm must remain on-screen');
    if (process.env.AI_CONFIG_TEST_SHOTS) await page.screenshot({ path: `${process.env.AI_CONFIG_TEST_SHOTS}/${theme}-390.png`, fullPage: false });
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
    assert(await action.isVisible(), 'Cancel must restore the row actions');
    console.log(`${theme}: phone action + named confirmation + cancel PASS`);
  }
  // Restore a deliberately wide saved action column and a non-default order.
  await page.evaluate(() => {
    localStorage.setItem('hadron:views:v1:ai-configs', JSON.stringify([{
      id: 'wide-actions', name: 'Wide actions', isDefault: true, listKey: 'ai-configs',
      view: { columnOrder: ['name', 'actions', 'provider', 'model', 'endpoint', 'enabled', 'key', 'createdAt'], columnSizing: { actions: 500, name: 400 } },
    }]));
    localStorage.setItem('hadron:views:v1:active:ai-configs', 'wide-actions');
  });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const header = page.getByRole('columnheader', { name: /^Actions/ });
    const size = await header.evaluate(e => e.getBoundingClientRect().width);
    assert(Math.abs(size - (width < 640 ? 170 : 500)) < 2, `Restored action width at ${width}: ${size}`);
    const action = page.getByRole('button', { name: 'Actions for phone-check', exact: true });
    if (width < 640) {
      const box = await action.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, `Restored Actions clipped at ${width}`);
      await action.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert(await action.evaluate(e => document.activeElement === e), 'Escape returns focus');
    }
    console.log(`saved width/order at ${width}: PASS`);
  }

} finally {
  await browser.close();
}
