// Synthetic geometry fixtures for the shared component at each adopted row's
// label set. Independent QA owns real signed-in route coverage, not this harness.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const rows = [
  ['app', 'tabs', ['Chats', 'AI Team', 'Human Team', 'Agents', 'Worklog', 'Runs', 'Memories', 'App Keys', 'AI Service Configs', 'Settings', 'Client', 'Channels', 'Tasks', 'Tickers', 'Stops', 'Token use', 'Action register', 'Automations']],
  ['agent', 'tabs', ['Profile', 'Boot prompt', 'Tasks', 'Processes', 'Memories', 'Apps', 'Ticker templates', 'Bundled agents', 'Nodes', 'Chatbot Control', 'AI Providers', 'Settings']],
  ['memories', 'tabs', ['My memories', 'Memories shared with me', 'A longer translated extra section']],
  ['worker', 'tabs', ['Profile', 'Boot briefing', 'Worker sessions', 'Worklog', 'Wake-ups', 'A longer translated extra section']],
  ['node', 'tabs', ['Chat', 'Info', 'Content', 'Discussion', 'Abstract', 'Data', 'Properties', 'Flow', 'Children', 'Edges', 'Revisions', 'Settings']],
  ['org-memories', 'tabs', ['Personal Memories', 'Org Memories', 'Subscriptions', 'A longer translated extra section']],
  ['org-agents', 'tabs', ['Organization agents', 'Subscribed', 'A longer translated extra section']],
  ['account', 'links', ['Account', 'Organization', 'Node-role templates', 'Invite', 'API Keys']],
  ['task-views', 'links', ['Board', 'Roster', 'Composition', 'Alarms', 'A longer translated extra section']],
];
// #1994: selected text must stay inside its column, and hidden text inside
// the real More menu, for both semantic modes and both breaking patterns.
const unbroken = 'x'.repeat(126);
const spaced = ('Oversized selected label with spaces '.repeat(4)).slice(0, 139);
for (const mode of ['tabs', 'links']) {
  for (const [kind, text] of [['unbroken', unbroken], ['spaced', spaced]]) {
    rows.push([`oversize-${kind}-${mode}`, mode, ['Short', text, 'Other']]);
    rows.push([`menu-${kind}-${mode}`, mode, ['Short', 'Selected', text]]);
  }
  rows.push([`exact-fit-${mode}`, mode, ['Exact fit control']]);
}
const cases = rows.filter(([name]) => !process.env.TAB_ROW_CASE || name === process.env.TAB_ROW_CASE);
assert.ok(cases.length, 'TAB_ROW_CASE must name a real fixture');
const screenshots = process.env.TAB_ROW_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const [name, mode, labels] of cases) for (const width of [390, 1280]) for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/__tab_row_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Tab row fixture</title>' }));
    await page.goto(new URL('/__tab_row_fixture', origin).href);
    await page.evaluate(([css, dark, width, name]) => {
      document.documentElement.classList.toggle('dark', dark);
      document.body.innerHTML = `<style>${css}</style><main style="width:${width === 390 ? 308 : 1000}px;margin:24px auto"><h1 class="mb-4 text-xl font-bold">${name}</h1><section id="row"></section></main>`;
      document.body.className = 'bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    }, [css, dark, width, name]);
    const items = labels.map((label, i) => ({ id: `item-${i}`, label, ...(mode === 'links' || name === 'app' && i >= 11 ? { href: `/view/${i}` } : {}) }));
    // A real label, not the forced extra label, is selected at both widths.
    const selected = name === 'app' ? 'item-9' : name.startsWith('exact-fit-') ? 'item-0' : 'item-1';
    await page.evaluate(async ([mode, items, selected]) => {
      const { mountRow } = await import('/src/lib/test/fixtures/tab-row-layout-harness.ts');
      mountRow(document.getElementById('row'), mode, items, selected);
    }, [mode, items, selected]);
    await page.waitForFunction(() => document.querySelector('[data-tab-row-root]'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (name.startsWith('exact-fit-')) {
      await page.evaluate(() => {
        const intrinsic = document.querySelector('[data-tab-row-measure]').getBoundingClientRect().width;
        document.querySelector('main').style.width = `${intrinsic}px`;
      });
      await page.waitForFunction(() => document.querySelector('[data-tab-row-root]').getBoundingClientRect().width ===
        document.querySelector('[data-tab-row-measure]').getBoundingClientRect().width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const measurement = await page.locator('[data-tab-row-root]').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, available: el.getBoundingClientRect().width, documentWidth: document.documentElement.scrollWidth }));
    assert.ok(measurement.documentWidth <= width, `${name}: document overflow`);
    assert.ok(measurement.scroll <= measurement.client, `${name}/${width}/${dark}: ${JSON.stringify(measurement)}`);
    const inline = page.locator('[data-row-choice]:not([aria-haspopup])');
    const reachable = await inline.allTextContents();
    const more = page.locator('[data-tab-row-root] [aria-haspopup=menu]');
    let menuGeometry = null;
    if (await more.count()) {
      await more.focus(); await page.keyboard.press('Enter');
      await page.locator('[role=menu]').waitFor();
      reachable.push(...await page.locator('[role=menuitem]').allTextContents());
      assert.ok((await page.locator('[role=menuitem]').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))).every(h => h >= 44), `${name}: coarse menu targets`);
      assert.ok((await more.boundingBox()).height >= 44, `${name}: coarse More target`);
      const box = await page.locator('[role=menu]').boundingBox();
      const wrap = await page.locator('[role=menuitem]').evaluateAll(els => els.map(el => ({whiteSpace:getComputedStyle(el).whiteSpace,overflowWrap:getComputedStyle(el).overflowWrap,scroll:el.scrollWidth,client:el.clientWidth})));
      menuGeometry = { box, wrap };
      if (screenshots && name.startsWith('menu-')) await page.screenshot({path:`${screenshots}/${name}-menu-${width}-${dark ? 'dark' : 'light'}.png`});
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${name}: menu leaves viewport ${JSON.stringify({box,wrap})}`);
      const contents = await page.locator('[role=menuitem]').evaluateAll(els => els.map(el => ({
        client: el.clientWidth, scroll: el.scrollWidth, label: el.textContent,
      })));
      assert.ok(contents.every(item => item.scroll <= item.client + 1), `${name}: menu text overflows ${JSON.stringify(contents)}`);

      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
      assert.equal(await more.evaluate(el => el === document.activeElement), true, `${name}: Escape focus`);
    }
    assert.deepEqual(reachable.map(s => s.trim()).sort(), [...labels].sort(), `${name}: every item reachable once`);
    const current = page.locator(mode === 'tabs' ? '[role=tab][aria-selected=true]' : '[aria-current=page]');
    assert.equal(await current.count(), 1, `${name}: selected always inline`);
    if (name.startsWith('oversize-') || name.startsWith('exact-fit-')) {
      const selectedGeometry = await current.evaluate(el => ({
        client: el.clientWidth, scroll: el.scrollWidth, whiteSpace: getComputedStyle(el).whiteSpace,
      }));
      const intrinsic = await page.locator(`[data-tab-row-measure]`).nth(Number(selected.slice(5))).evaluate(el => el.getBoundingClientRect().width);
      assert.equal(await current.textContent(), labels[Number(selected.slice(5))], `${name}: whole selected text`);
      assert.ok(selectedGeometry.scroll <= selectedGeometry.client + 1, `${name}: selected text overflows`);
      // portal#2006 item 4 — this +0.01px is NOT the component's comparator.
      // The component decides with a strict `>` (TabRow.svelte `oversizeSelection`:
      // measured label width > row width — exact by design; the unit suite pins
      // the boundary at 399/400). This line only PREDICTS that decision from two
      // independently-laid-out elements (the off-layout measure span and the row),
      // whose float rects can differ by subpixels at an exact-fit boundary the
      // exact-fit control deliberately rides. The epsilon absorbs that prediction
      // noise and nothing else: the wrap decision, and every scroll/client
      // assertion here, stays exact. Do not copy this slack into the component.
      assert.equal(selectedGeometry.whiteSpace, intrinsic > measurement.available + 0.01 ? 'normal' : 'nowrap', `${name}: wrap only when oversized`);
    }

    if (mode === 'links') assert.equal(await page.locator('[role=tab], [role=tablist], [aria-selected]').count(), 0);
    assert.ok((await inline.evaluateAll(els => els.map(el => el.getBoundingClientRect().height))).every(h => h >= 44), `${name}: coarse targets`);
    if (width === 390 && labels.at(-1) === 'A longer translated extra section' && mode === 'tabs') {
      await more.click();
      await page.getByRole('menuitem', { name: labels.at(-1), exact: true }).click();
      const selectedTab = page.locator('[role=tab][aria-selected=true]');
      await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes('A longer'));
      const selectedBox = await selectedTab.boundingBox();
      const moreBox = await more.boundingBox();
      assert.ok(moreBox.y >= selectedBox.y + selectedBox.height - 1, `${name}: wide selected label must put More on the next line`);
      assert.equal(await page.locator('[data-tab-row-root]').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await selectedTab.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    }
    if (screenshots) await page.screenshot({ path: `${screenshots}/${name}-${width}-${dark ? 'dark' : 'light'}.png` });
    // Removing a chosen menu item must not lose focus when navigation is
    // cancelled. The positive native-link control still commits its href.
    if (await more.count()) {
      await more.click();
      const firstLink = page.locator('[role=menuitem][href]').first();
      if (await firstLink.count()) {
        const href = await firstLink.getAttribute('href');
        await firstLink.evaluate(el => el.addEventListener('click', event => event.preventDefault(), { once: true }));
        await firstLink.click();
        assert.equal(await more.evaluate(el => el === document.activeElement), true, `${name}: cancelled link keeps a surviving focus target`);
        await more.click();
        await page.route('**/view/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native link destination</title>' }));
        await Promise.all([page.waitForURL(new URL(href, origin).href), page.locator(`[role=menuitem][href="${href}"]`).click()]);
      } else {
        await page.keyboard.press('Escape');
      }
    }
    assert.deepEqual(pageErrors, [], `${name}: unexpected fixture page error`);
    console.log(JSON.stringify({ name, width, dark, ...measurement, menu: menuGeometry, reachable: reachable.length }));
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
