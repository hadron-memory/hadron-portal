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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
    const action = page.getByRole('button', { name: 'Actions for phone-check', exact: true });
    await action.waitFor();
    const box = await action.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390, `${theme}: Actions must be visible at 390px; x=${box?.x}`);
    await action.click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Delete', exact: true });
    await confirm.waitFor();
    const question = await confirm.evaluate(el => el.parentElement.textContent);
    assert(question.includes('phone-check') && question.includes('cannot be undone'), 'Visible confirmation must name the config');
    const confirmBox = await confirm.boundingBox();
    assert(confirmBox && confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= 390, 'Confirm must remain on-screen');
    if (process.env.AI_CONFIG_TEST_SHOTS) await page.screenshot({ path: `${process.env.AI_CONFIG_TEST_SHOTS}/${theme}-390.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert(await action.isVisible(), 'Cancel must restore the row actions');
    console.log(`${theme}: phone action + named confirmation + cancel PASS`);
  }
} finally {
  await browser.close();
}
