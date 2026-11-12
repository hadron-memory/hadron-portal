// #1867: native pointer hit-testing, not a jsdom stacking-class assertion.
// #1954 additions: actual coarse/fine pointer identification, saved 500px
// middle-order width math at BOTH widths, custom/hover row colors surviving
// the sticky cell, and a pre-hydration SSR first-paint width oracle.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { assertActionAtScrollEdges } from './lib/ai-config-browser.mjs';

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
  const longName = 'x' + '_'.repeat(63);
  const fixtures = [['disabled', [['config-02', false]]], ['enabled', [['config-02', true]]], ['mixed', [['config-02', false], ['config-04', true]]], ['long-name', [[longName, true]]]];
  // #1996: the default column order (Actions last, after the dimmed key preview) is what ships;
  // `middle` is the saved #1954 view. Both must keep the Actions trigger reachable at the scroll edges.
  for (const order of ['middle', 'default']) for (const width of [390, 1280]) for (const dark of [false, true]) for (const [mode, targets] of fixtures) {
    if (order === 'default' && (width !== 390 || mode !== 'disabled')) continue;
    const label = `${order}-${width}-${dark ? 'dark' : 'light'}-${mode}`;
    // #1954: the phone cases run as an actual touch device (coarse pointer),
    // the desktop cases as fine pointer — asserted, not assumed.
    const page = await browser.newPage(width === 390
      ? { viewport: { width, height: 900 }, hasTouch: true, isMobile: true }
      : { viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
    await page.route('**/__ai_config_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>AI config row fixture</title><meta name="viewport" content="width=device-width, initial-scale=1">' }));
    await page.route('**/api/ai-configs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) }));
    await page.goto(new URL('/__ai_config_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
      document.head.innerHTML = `<style>${css}</style>`;
      document.documentElement.classList.toggle('dark', dark);
      document.body.innerHTML = `<main class="p-6 ${dark ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-900'}" id="fixture"></main>`;
    }, { css, dark });
    // #1954: seed the saved wide/middle-order view at BOTH widths — the phone
    // must clamp the restored 500px actions column to 170, the desktop must
    // keep the saved 500px live (saved views and touch, not just fresh state).
    if (order === 'middle') await page.evaluate(() => {
      localStorage.setItem('hadron:views:v1:ai-configs', JSON.stringify([{
        id: 'middle-actions', name: 'Middle actions', isDefault: true, listKey: 'ai-configs',
        view: { columnOrder: ['name', 'actions', 'provider', 'model', 'endpoint', 'enabled', 'key', 'createdAt'], columnSizing: { actions: 500, name: 400 } },
      }]));
    });
    assert(await page.evaluate(query => matchMedia(query).matches, width === 390 ? '(pointer: coarse)' : '(pointer: fine)'), `${label}: expected ${width === 390 ? 'coarse' : 'fine'} pointer`);
    await page.evaluate(async ({ mode, longName }) => {
      const { mountAiConfigRows } = await import('/src/lib/test/fixtures/ai-config-row-menu-harness.ts');
      mountAiConfigRows(document.getElementById('fixture'), mode === 'long-name' ? 'enabled' : mode, mode === 'long-name' ? longName : undefined);
    }, { mode, longName });
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
      if (order === 'middle') {
        assert.match((await page.locator('th').allTextContents())[1], /Actions/, 'Saved order applied');
        // #1954: the restored saved width survives — clamped to 170 on the
        // phone, live 500 on the desktop, never one width at the other.
        const header = page.getByRole('columnheader', { name: /^Actions/ });
        const size = await header.evaluate(e => e.getBoundingClientRect().width);
        assert(Math.abs(size - (width === 390 ? 170 : 500)) < 2, `${where}: saved Actions width at ${width}: ${size}`);
      }
      if (width === 390) {
        // #1954: custom and hovered row colors survive the sticky actions cell
        // (computed style, so a missing utility fails here by value). Tailwind
        // gates hover: variants on @media (hover: hover), which this actual
        // coarse-pointer page fails: a tap raises :hover on the row without
        // engaging the hover color anywhere — on a real phone the row never
        // gets a hover tint to survive. The phone therefore pins base
        // inheritance, sticky-equals-row while tap-hovered, and a class-driven
        // row recolor — the same computed-background mechanism a hover-capable
        // pointer's hover color rides, so a hardcoded sticky background fails
        // here by value.
        const stickyTd = row.locator('td[class*="max-sm:sticky"]');
        const stickyBg = () => stickyTd.evaluate(el => getComputedStyle(el).backgroundColor);
        const rowBg = () => row.evaluate(el => getComputedStyle(el).backgroundColor);
        // Expectations are computed by the same engine (a scratch element
        // carrying the class), so Tailwind v4's oklch color space is
        // compared like-for-like, not hand-transcribed.
        const classBg = cls => page.evaluate(c => {
          const el = document.createElement('div');
          el.className = c;
          document.body.appendChild(el);
          const bg = getComputedStyle(el).backgroundColor;
          el.remove();
          return bg;
        }, cls);
        const want = dark
          ? { base: await classBg('dark:bg-zinc-950'), custom: await classBg('dark:bg-amber-900') }
          : { base: await classBg('bg-white'), custom: await classBg('bg-amber-100') };
        // #1973 review (BLIND P2): bg-inherit is only safe on an OPAQUE row —
        // a see-through row would show scrolled columns under the pinned cell.
        // Computed equality with the opaque utility's own computed value is
        // the opacity proof: it fails by value if the row ever stops painting
        // a full background in either color scheme.
        assert.equal(await rowBg(), want.base, `${where}: row paints an opaque base background`);
        assert.equal(await stickyBg(), want.base, `${where}: sticky cell inherits the row background`);
        await row.locator('td').first().tap();
        assert(await row.evaluate(el => el.matches(':hover')), `${where}: tap raises :hover on the row`);
        assert.equal(await rowBg(), want.base, `${where}: hover color stays inert on a hover-incapable pointer`);
        assert.equal(await stickyBg(), await rowBg(), `${where}: sticky cell equals the row while hovered`);
        // The custom class must actually recolor the row: Tailwind sorts
        // `.bg-amber-100` before `.bg-white`, so the base class is swapped
        // out for the check and restored after — the sticky cell is what is
        // under test, not the utility cascade.
        await row.evaluate((el, [add, base]) => { el.classList.remove(base); el.classList.add(add); }, dark ? ['dark:bg-amber-900', 'dark:bg-zinc-950'] : ['bg-amber-100', 'bg-white']);
        // Row first, then the sticky cell: if anything ever clobbers the
        // injected class between the two reads, the failure names the row
        // (class did not take) instead of masquerading as broken inheritance.
        assert.equal(await rowBg(), want.custom, `${where}: row recolored by the custom class`);
        assert.equal(await stickyBg(), want.custom, `${where}: sticky cell follows a custom row background class`);
        await row.evaluate((el, [add, base]) => { el.classList.remove(add); el.classList.add(base); }, dark ? ['dark:bg-amber-900', 'dark:bg-zinc-950'] : ['bg-amber-100', 'bg-white']);
      }
      // #1956: both scroll extremes before each menu action (subsumes the
      // single far-right containment check this loop used to run inline).
      if (width === 390) await assertActionAtScrollEdges(page, trigger, where, order === 'middle' ? 1 : -1);
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
      // #2051: the Edit heading carries the full legal name; a long uninterrupted
      // token must wrap inside the editor card, never past it or the page. The
      // name is wrapped, not truncated or rewritten.
      const heading = page.getByRole('heading', { level: 3 }).filter({ hasText: name });
      assert.equal((await heading.textContent()).trim(), `“${name}”`, `${where}: Edit heading shows the full name`);
      const [card, title] = await Promise.all([heading.locator('xpath=..').boundingBox(), heading.boundingBox()]);
      assert(card && title && title.x >= card.x - 0.5 && title.x + title.width <= card.x + card.width + 0.5, `${where}: Edit heading inside the editor card (${JSON.stringify({ card, title })})`);
      assert(await heading.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${where}: Edit heading text does not overflow its box`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${where}: Edit heading leaves the page no wider than the viewport`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await nameInput.waitFor({ state: 'detached', timeout: 2000 });
      if (width === 390) await assertActionAtScrollEdges(page, trigger, where, order === 'middle' ? 1 : -1);
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click({ timeout: 2000 });
      const question = row.getByText(`Delete the “${name}” configuration? This cannot be undone.`, { exact: true });
      await question.waitFor();
      const container = width === 390 ? page.getByTestId('data-table-scroller') : question.locator('xpath=ancestor::td[1]');
      const [viewport, text] = await Promise.all([container.boundingBox(), question.boundingBox()]);
      assert(viewport && text && text.x >= viewport.x && text.x + text.width <= viewport.x + viewport.width, `${where}: full named confirmation fits inside its available column`);
      assert(await question.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${where}: full name wraps without hidden text`);
      await row.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await row.getByText(`Delete the “${name}” configuration? This cannot be undone.`, { exact: true }).count(), 0, `${where}: Delete confirmation cancels`);
      console.log(`${where} PASS: Edit and Delete receive native pointer clicks; opacity on content only`);
    }
    assert.deepEqual(errors, [], `${label}: no page errors or console errors`);
    await page.close();
  }

  // #1954: no action-column width flash between first render and hydration.
  // The SERVER markup itself must lay out the phone widths: SSR'd HTML is
  // injected with no Svelte runtime at all — exactly what a phone paints
  // first. A JS-decided phone width (a matchMedia effect starting false)
  // measures the desktop 400px here; the CSS-decided width measures the
  // 170px clamp.
  const ssrHarness = await server.ssrLoadModule('/src/lib/test/DataTableFitOnPhoneHarness.svelte');
  const { render } = await server.ssrLoadModule('svelte/server');
  const ssrHtml = render(ssrHarness.default, { props: { multiColumn: true, stickyEndColumn: 'second' } }).body;
  assert(ssrHtml.includes('--phone-table-w: max(100%, 1770px)'), 'SSR markup carries the phone table width');
  // #1973 review (BLIND P2): the single-column fitOnPhone collapse — the
  // table's media-query width BECOMING 100% of its container on a real phone
  // viewport — executed nowhere. Same SSR-only injection, measuring the whole
  // TABLE against its container instead of one header cell.
  const ssrFitHtml = render(ssrHarness.default, { props: { fitOnPhone: true } }).body;
  for (const [width, wantEnd] of [[390, 170], [1280, 400]]) {
    const page = await browser.newPage(width === 390
      ? { viewport: { width, height: 600 }, hasTouch: true, isMobile: true }
      : { viewport: { width, height: 600 } });
    await page.route('**/__ssr_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>SSR first paint</title><meta name="viewport" content="width=device-width, initial-scale=1">' }));
    await page.goto(new URL('/__ssr_fixture', origin).href);
    await page.evaluate(({ css, ssrHtml, ssrFitHtml }) => {
      document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
      document.body.innerHTML = `<main id="ssr">${ssrHtml}</main><main id="ssr-fit">${ssrFitHtml}</main>`;
    }, { css, ssrHtml, ssrFitHtml });
    const endWidth = await page.locator('#ssr th').nth(1).evaluate(e => e.getBoundingClientRect().width);
    assert(Math.abs(endWidth - wantEnd) < 2, `SSR first-paint end column at ${width}: ${endWidth} (want ${wantEnd})`);
    // Single-column fit: 100% of the container at phone width, live 1600px
    // TanStack sizing on the desktop — both from markup alone, no hydration.
    // The oracle is the SCROLLER's client box (the 100% resolves against the
    // bordered scroller DataTable wraps the table in, not the bare main).
    const fitWidth = await page.locator('#ssr-fit table').evaluate(e => e.getBoundingClientRect().width);
    if (width === 390) {
      const container = await page.locator('#ssr-fit [data-testid="data-table-scroller"]').evaluate(e => e.clientWidth);
      assert(Math.abs(fitWidth - container) < 1, `SSR single-column fit collapses to the container at ${width}: ${fitWidth} vs ${container}`);
    } else {
      assert(Math.abs(fitWidth - 1600) < 2, `SSR single-column fit keeps TanStack width at ${width}: ${fitWidth}`);
    }
    await page.close();
    console.log(`SSR first-paint at ${width}: PASS (end column ${wantEnd}px, single-column fit ${Math.round(fitWidth)}px, before any hydration JS)`);
  }
} finally {
  await browser?.close();
  await server.close();
}
