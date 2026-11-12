// Fixture-specific evidence for the TabRow overflow follow-up (#1994) — NOT a
// general production runbook. It assumes the named disposable stack from the
// README ("Real signed-in author route": stack `george1994`, API on 14894,
// Vite portal on 15894, synthetic alpha-admin/e2e-alpha only) and is inert
// without it: the DEV_LOGIN hand-off on the API port 14894 is what redirects
// into the portal on 15894 (that redirect is why this probe addresses 14894
// while the route under test renders on 15894).
//
// Exact stdout-to-JSONL rerun (from the repo root, stack running; overwrites
// the evidence PNGs and the results file):
//   node docs/evidence/1994/author-route-probe.mjs > docs/evidence/1994/author-route-results.jsonl
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'docs/evidence/1994';
await mkdir(out, { recursive: true });
const org = createHash('sha256').update('hadron-e2e:e2e-alpha').digest('hex').slice(0, 32);
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark'])
  for (const [kind, text] of [['unbroken', 'x'.repeat(126)], ['spaced', ('Oversized selected label with spaces '.repeat(4)).slice(0, 139)]]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, hasTouch: width === 390, colorScheme: theme });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:14894/auth/dev/login?email=alpha-admin%40e2e.test&redirect=' + encodeURIComponent(`/app/orgs/${org}/agents`));
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-tab-row-root] [role=tab][aria-selected=true]');
        return el && '__svelte_meta' in el; // Vite-dev hydration marker.
      });
      // Explicit fixture premises, before any substitution: the DEV_LOGIN
      // hand-off landed signed-in on the portal port with the real org-agents
      // route, whose row is ['Organization agents', 'Subscribed', …] — the
      // selected label and the measure twins later steps rewrite depend on.
      assert.match(page.url(), /^http:\/\/localhost:15894\/app\/orgs\//, 'DEV_LOGIN must land signed-in on the portal port, not the API port');
      assert.equal(await page.locator('[data-tab-row-root] [role=tab][aria-selected=true]').textContent(), 'Organization agents', 'org-agents fixture row premise');
      assert.ok(await page.locator('[data-tab-row-measure]').count() >= 2, 'fixture needs at least two measure twins');
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark');
      assert.equal(await page.evaluate(() => matchMedia('(pointer:coarse)').matches), width === 390);
      // Synthetic long translations on the REAL signed-in route, not shipped data.
      // Rewrite the selected text and its intrinsic-measure twin, then use native resize.
      await page.evaluate(text => {
        const root = document.querySelector('[data-tab-row-root]');
        root.querySelector('[role=tab][aria-selected=true]').textContent = text;
        document.querySelectorAll('[data-tab-row-measure]')[0].textContent = text;
        window.dispatchEvent(new Event('resize'));
      }, text);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const selected = page.locator('[data-tab-row-root] [role=tab][aria-selected=true]');
      const sg = await selected.evaluate(el => ({ text: el.textContent, scroll: el.scrollWidth, client: el.clientWidth, whiteSpace: getComputedStyle(el).whiteSpace }));
      const rg = await page.locator('[data-tab-row-root]').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, width: el.getBoundingClientRect().width }));
      const intrinsic = await page.locator('[data-tab-row-measure]').first().evaluate(el => el.getBoundingClientRect().width);
      assert.equal(sg.text, text);
      assert.ok(sg.scroll <= sg.client + 1);
      assert.ok(rg.scroll <= rg.client);
      assert.equal(sg.whiteSpace, intrinsic > rg.width ? 'normal' : 'nowrap');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (kind === 'unbroken') await page.screenshot({ path: `${out}/selected-${width}-${theme}.png` });
      // Restore the selected text; make only the unselected measure twin oversized.
      await page.evaluate(text => {
        const root = document.querySelector('[data-tab-row-root]');
        root.querySelector('[role=tab][aria-selected=true]').textContent = 'Organization agents';
        const m = document.querySelectorAll('[data-tab-row-measure]');
        m[0].textContent = 'Organization agents';
        m[1].textContent = text;
        window.dispatchEvent(new Event('resize'));
      }, text);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const more = page.locator('[data-tab-row-root] [aria-haspopup=menu]');
      await more.waitFor();
      // Hold the ORIGINAL element handles across the rewrites below: reselecting
      // by replaced text timed out in the first probe (harness error, not product).
      const handle = await more.elementHandle();
      await more.click();
      await page.waitForFunction(el => el.isConnected && el.getAttribute('aria-expanded') === 'true', handle);
      const choice = page.getByRole('menuitem').filter({ hasText: 'Subscribed' });
      const choiceHandle = await choice.elementHandle();
      await choiceHandle.evaluate((el, text) => { el.textContent = text; }, text);
      const mg = await page.getByRole('menu', { name: 'More sections' }).evaluate(el => ({ x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right, client: el.clientWidth, scroll: el.scrollWidth }));
      const cg = await choiceHandle.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, wrap: getComputedStyle(el).overflowWrap, whiteSpace: getComputedStyle(el).whiteSpace, height: el.getBoundingClientRect().height }));
      assert.ok(mg.x >= 0 && mg.right <= width + 1);
      assert.ok(mg.scroll <= mg.client + 1);
      assert.ok(cg.scroll <= cg.client + 1);
      assert.equal(cg.wrap, 'anywhere');
      assert.equal(cg.whiteSpace, 'normal');
      assert.ok(cg.height >= (width === 390 ? 44 : 30));
      if (kind === 'unbroken') await page.screenshot({ path: `${out}/menu-${width}-${theme}.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(el => el.isConnected && el.getAttribute('aria-expanded') === 'false', handle);
      assert.equal(await more.evaluate(el => el === document.activeElement), true);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, theme, kind, selected: sg, row: rg, menu: mg, item: cg, pass: true }));
    } finally {
      // portal#2006 item 5: each context closes itself even when one of its
      // assertions fails, so a failing context cannot leak pages into the
      // browser the outer finally closes.
      await context.close();
    }
  }
} finally { await browser.close(); }
