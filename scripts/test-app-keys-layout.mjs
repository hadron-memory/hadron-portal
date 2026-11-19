// portal#2135: App page, Keys tab — Generate Key centered on the label INPUT,
// and the key table filling the tab panel. portal#1487 adds the Grant scope
// dialog (row ⋯ menu → showModal): fits the viewport at every width, host
// field helper UNDER the field, and the empty-host refusal rendering inside
// the still-open dialog. Real Chromium, the compiled app CSS, and the REAL
// `/app/apps/[appId]/+page.svelte` inside a copy of the
// `/app` shell (sidebar `w-48 hidden sm:flex`, gutters, `min-w-0 flex-1`
// content column). Synthetic data from
// src/lib/test/fixtures/app-keys-layout-harness.ts: no server, no key minted,
// no provider. Independent QA owns the signed-in route matrix.
//
// jsdom has no layout, so these are the checks that prove it: measured
// rectangles and computed styles, never class names.
//
// Setup: pnpm exec playwright install chromium
// Run:   pnpm test:app-keys-layout
// Knobs: KEYS_WIDTH=<px> (one width), KEYS_SHOTS=<dir> (screenshots),
//        KEYS_MUTANT=<name> (apply one source mutant; the run must FAIL).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer, createLogger } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

// Each mutant reverts or breaks ONE part of the chosen implementation. The
// replacement must apply, or the run aborts: a mutant that silently did not
// apply would pass and prove nothing.
const MUTANTS = {
  // the input top-pinned in the shared row (the 44px button is the row's
  // tallest item, so the BUTTON's own self-start/stretch is equivalent to
  // self-center and is not a mutant: the input's alignment is what centers)
  'input-start': [/@sm:self-center @sm:col-start-1 @sm:row-start-2/, '@sm:self-start @sm:col-start-1 @sm:row-start-2'],
  // the button lands on the label row, not the input row
  'button-row': [/@sm:col-start-2 @sm:row-start-2/, '@sm:col-start-2 @sm:row-start-1'],
  // the old 42rem cap back around the table
  'table-capped': [/<section data-testid="app-keys-section">/, '<section data-testid="app-keys-section" class="max-w-2xl">'],
  // "fit" by hiding the overflow instead of scrolling it
  'hidden-overflow': [/<section data-testid="app-keys-section">/, '<section data-testid="app-keys-section" class="[&_[data-testid=data-table-scroller]]:!overflow-hidden">'],
  // never stack: the inline row is forced at every width
  'no-stack': [/grid grid-cols-1 gap-x-2 @sm:/, 'grid grid-cols-[minmax(200px,1fr)_auto] gap-x-2 @sm:'],
  // portal#1487: the grant dialog loses its viewport clamp — wider than a
  // phone screen, so the within-viewport check must catch it
  'dialog-unclamped': [/w-\[calc\(100%-2rem\)\]/, 'w-[40rem]'],
};
const mutantName = process.env.KEYS_MUTANT ?? null;
if (mutantName && !MUTANTS[mutantName]) throw new Error(`KEYS_MUTANT must be one of ${Object.keys(MUTANTS).join(', ')}`);
let mutantApplied = false;
const PAGE = /\/routes\/app\/apps\/\[appId\]\/\+page\.svelte$/;

const stub = (name) => resolve('src/lib/test/stubs', name);
// A late dependency re-optimization reloads the page under a mounted
// component; measurements taken across it mean nothing. Fail loudly instead.
const lateOptimizations = [];
const logger = createLogger();
const info = logger.info.bind(logger);
logger.info = (msg, opts) => {
  if (/new dependencies optimized|optimized dependencies changed/.test(msg)) lateOptimizations.push(msg.trim());
  info(msg, opts);
};
// No SvelteKit plugin: it would resolve `$app/*` to the real runtime ahead of
// these aliases, and the page then talks to a kit client that isn't there.
// This is the client test lane's environment (vitest.config.ts), plus Tailwind.
const server = await createServer({
  configFile: false,
  customLogger: logger,
  // Own pre-bundle cache, so this run never invalidates the dev server's.
  cacheDir: 'node_modules/.vite-app-keys-layout',
  // Superforms imports `$app/*` itself; pre-bundling would resolve those
  // before the aliases apply.
  //
  // `entries` (portal#2137 LOCAL F1): with no index.html there is nothing for
  // Vite's startup scan to crawl, so on a cold cache it discovered deps
  // (marked, @tanstack/table-core) only when the page first imported them,
  // re-optimized and RELOADED the page mid-mount. Two copies of svelte's
  // runtime then threw lifecycle_outside_component / effect_orphan. Scanning
  // the harness's import graph up front pre-bundles every dep before the
  // first request; the run below also fails if a late re-optimization happens.
  optimizeDeps: { entries: ['src/lib/test/fixtures/app-keys-layout-harness.ts'], exclude: ['sveltekit-superforms'] },
  server: { host: '127.0.0.1', port: 0 },
  resolve: { alias: {
    $lib: resolve('src/lib'),
    '$app/navigation': stub('app-navigation.ts'),
    '$app/environment': stub('app-environment.ts'),
    '$app/stores': stub('app-stores.ts'),
    '$app/state': stub('app-state.ts'),
    '$app/forms': stub('app-forms.ts'),
    '$env/dynamic/public': stub('env-dynamic-public.ts'),
  } },
  plugins: [tailwindcss(), svelte(), {
    name: 'app-keys-mutant',
    enforce: 'pre',
    transform(code, id) {
      if (!mutantName || !PAGE.test(id.split('?')[0])) return null;
      const [from, to] = MUTANTS[mutantName];
      if (!from.test(code)) throw new Error(`mutant ${mutantName} did not apply`);
      mutantApplied = true;
      return code.replace(from, to);
    },
  }],
});

const WIDTHS = process.env.KEYS_WIDTH ? [Number(process.env.KEYS_WIDTH)] : [320, 390, 768, 1024, 1440];
// Widths at which the gate requires the inline row (button centered on input).
const INLINE_AT = new Set([768, 1024, 1440]);
const STATES = ['default', 'error', 'generating'];
const PREVIEWS = ['hdr_app_3f…9c', 'hdr_app_a1…07', 'hdr_app_5e…d2'];
const failures = [];

function geometry() {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const panel = document.getElementById('panel-keys');
  const form = panel.querySelector('form[action="?/createKey"]');
  const input = form.querySelector('#label');
  const button = form.querySelector('button[type="submit"]');
  const error = form.querySelector('[role="alert"]');
  const scroller = panel.querySelector('[data-testid="data-table-scroller"]');
  const doc = document.scrollingElement;
  return {
    panel: r(panel), panelContent: panel.clientWidth, form: r(form), input: r(input), button: r(button),
    error: error ? r(error) : null, scroller: r(scroller),
    scrollerClient: scroller.clientWidth, scrollerScroll: scroller.scrollWidth,
    scrollerOverflowX: getComputedStyle(scroller).overflowX,
    pageOverflow: doc.scrollWidth - doc.clientWidth,
    buttonText: button.textContent.trim(), buttonDisabled: button.disabled,
    buttonBg: getComputedStyle(button).backgroundColor,
    coarse: matchMedia('(pointer: coarse)').matches,
  };
}

// Scroll a cell into the scroller's view the way a reader would, then report
// whether it sits fully inside the scroller's visible box.
function reach(selector) {
  const scroller = document.querySelector('#panel-keys [data-testid="data-table-scroller"]');
  const el = scroller.querySelector(selector);
  if (!el) return { found: false };
  scroller.scrollLeft = 0;
  const s = scroller.getBoundingClientRect();
  const before = el.getBoundingClientRect();
  scroller.scrollLeft += before.right - (s.left + scroller.clientWidth);
  if (scroller.scrollLeft < 0) scroller.scrollLeft = 0;
  const b = el.getBoundingClientRect();
  const out = { found: true, left: b.left - s.left, right: (s.left + scroller.clientWidth) - b.right, scrollLeft: scroller.scrollLeft };
  scroller.scrollLeft = 0;
  return out;
}

async function settle(page) {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function open(browser, origin, css, { width, dark, state, savedView }) {
  const phone = width < 640;
  const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: phone, isMobile: false });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.KEYS_DEBUG) page.on('console', (m) => console.log('console:', m.type(), m.text()));
  await page.route('**/__keys_fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>App keys fixture</title>' }));
  // The page's own background reads (fetch/XHR only; module requests pass through).
  await page.route('**/api/**', (r) => (['fetch', 'xhr'].includes(r.request().resourceType())
    ? r.fulfill({ contentType: 'application/json', body: '{}' }) : r.continue()));
  await page.goto(new URL('/__keys_fixture', origin).href);
  await page.evaluate(({ css, dark, savedView }) => {
    localStorage.clear();
    if (savedView) {
      const record = { id: 'wide', listKey: 'apps:keys', name: 'Wide', isDefault: false, view: { columnSizing: savedView }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
      localStorage.setItem('hadron:views:v1:apps:keys', JSON.stringify([record]));
      localStorage.setItem('hadron:views:v1:active:apps:keys', 'wide');
    }
    document.head.innerHTML = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>`;
    document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    // The /app shell's row: same classes as src/routes/app/+layout.svelte.
    document.body.innerHTML = '<main><div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">'
      + '<aside class="sticky top-8 self-start w-48 shrink-0 flex-col hidden sm:flex" style="height: 600px"><nav class="text-sm">Sidebar</nav></aside>'
      + '<div class="min-w-0 flex-1" id="fixture"></div></div></main>';
  }, { css, dark, savedView });
  await page.evaluate(async (state) => {
    const h = await import('/src/lib/test/fixtures/app-keys-layout-harness.ts');
    window.stopKeys = await h.mountAppKeys(document.getElementById('fixture'), { error: state === 'error' });
  }, state);
  await page.locator('#panel-keys tbody tr').first().waitFor();
  if (state === 'generating') {
    await page.evaluate(async () => {
      const h = await import('/src/lib/test/fixtures/app-keys-layout-harness.ts');
      await h.beginGenerating(document.querySelector('#panel-keys form[action="?/createKey"]'));
    });
    await page.locator('#panel-keys form[action="?/createKey"] button[type="submit"]:disabled').waitFor();
  }
  await settle(page);
  return { page, errors };
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  if (process.env.KEYS_SHOTS) await mkdir(process.env.KEYS_SHOTS, { recursive: true });

  for (const width of WIDTHS) for (const dark of [false, true]) for (const state of STATES) {
    const leg = `${width}/${dark ? 'dark' : 'light'}/${state}`;
    const { page, errors } = await open(browser, origin, css, { width, dark, state });
    try {
      const g = await page.evaluate(geometry);
      const check = (ok, msg) => { if (!ok) failures.push(`${leg}: ${msg}`); };
      check(g.pageOverflow <= 0, `page overflows horizontally by ${g.pageOverflow}px`);
      if (width < 640) check(g.coarse, 'phone leg is not (pointer: coarse)');

      // Table fills the Keys panel's content width, at every width.
      check(near(g.scroller.width, g.panelContent), `table scroller ${g.scroller.width.toFixed(1)}px ≠ panel content ${g.panelContent}px`);
      // Default sizing (960px) fits at 1440: no needless internal scroll.
      if (width === 1440) check(g.scrollerScroll <= g.scrollerClient, `internal horizontal scroll at 1440 (${g.scrollerScroll} > ${g.scrollerClient})`);
      check(['auto', 'scroll'].includes(g.scrollerOverflowX), `scroller overflow-x is ${g.scrollerOverflowX}`);

      // The create row: minimums, no overlap, inside the form.
      check(g.input.width >= 200, `input ${g.input.width.toFixed(1)}px < 200px`);
      check(g.button.height >= 44, `button ${g.button.height.toFixed(1)}px < 44px tall`);
      check(g.button.left >= g.form.left - 0.5 && g.button.right <= g.form.right + 0.5, 'button escapes the form row');
      check(g.button.right <= g.panel.right + 0.5, 'button clipped by the panel');
      const overlapX = g.button.left < g.input.right && g.input.left < g.button.right;
      const overlapY = g.button.top < g.input.bottom && g.input.top < g.button.bottom;
      check(!(overlapX && overlapY), 'button overlaps the input');
      if (g.error) check(!(g.button.left < g.error.right && g.error.left < g.button.right && g.button.top < g.error.bottom && g.error.top < g.button.bottom), 'button overlaps the error');
      const inline = overlapY;
      if (INLINE_AT.has(width)) {
        check(inline, 'create row is not inline');
        const dy = (g.button.top + g.button.height / 2) - (g.input.top + g.input.height / 2);
        check(Math.abs(dy) <= 1, `button center is ${dy.toFixed(1)}px from the input center`);
        check(g.button.left >= g.input.right, 'button is not to the right of the input');
      } else if (!inline) {
        // Stacked: the same button sits below the input (and its error), full width.
        check(g.button.top >= (g.error ?? g.input).bottom, 'stacked button is not below the input/error');
        check(near(g.button.width, g.form.width), `stacked button ${g.button.width.toFixed(1)}px ≠ row ${g.form.width.toFixed(1)}px`);
      }
      if (width <= 390) check(!inline, 'create row did not stack at a phone width');

      // States keep their label, accent fill and disabled behavior.
      check(g.buttonBg === 'rgb(251, 133, 0)', `button fill ${g.buttonBg}`);
      if (state === 'generating') check(g.buttonDisabled && g.buttonText === 'Generating...', `generating state: ${g.buttonDisabled} "${g.buttonText}"`);
      else check(!g.buttonDisabled && g.buttonText === '+ Generate Key', `idle state: ${g.buttonDisabled} "${g.buttonText}"`);
      if (state === 'error') check(g.error !== null, 'error state rendered no alert');

      // Preview, Scopes and the actions menu stay reachable inside the scroller.
      for (const [what, sel] of [['preview', 'tbody tr:first-child td:nth-child(2) span.font-mono'], ['scopes', '[data-testid="key-scopes"]'], ['actions', 'tbody tr:last-child td:last-child button']]) {
        const r = await page.evaluate(reach, sel);
        check(r.found, `${what} cell not rendered`);
        if (r.found) check(r.left >= -1 && r.right >= -1, `${what} not reachable (left ${r.left.toFixed(1)}, right ${r.right.toFixed(1)})`);
      }
      // Masking: the cells show exactly the stored previews.
      const previews = await page.evaluate(() => {
        const panel = document.getElementById('panel-keys');
        const col = [...panel.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim().startsWith('Preview'));
        return [...panel.querySelectorAll('tbody tr')].map((tr) => tr.children[col]?.textContent.trim());
      });
      check(JSON.stringify(previews) === JSON.stringify(PREVIEWS), `previews ${JSON.stringify(previews)}`);
      check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
      if (process.env.KEYS_SHOTS) await page.screenshot({ path: `${process.env.KEYS_SHOTS}/keys-${width}-${dark ? 'dark' : 'light'}-${state}.png`, fullPage: true });
    } finally { await page.close(); }
  }

  // portal#1487: the Grant scope dialog on the same real page — opened from
  // a row's ⋯ menu, real showModal in real Chromium (top layer, dimmed
  // backdrop). One leg per width/theme walks the reader's whole path:
  // attention:deliver (no host field) → host:operate (host field with its
  // helper UNDER the field) → the empty-host refusal (real client validation
  // running in the real browser: the alert renders inside the still-open
  // dialog and the submit un-sticks).
  for (const width of WIDTHS) for (const dark of [false, true]) {
    const leg = `grant/${width}/${dark ? 'dark' : 'light'}`;
    const { page, errors } = await open(browser, origin, css, { width, dark, state: 'default' });
    try {
      const check = (ok, msg) => { if (!ok) failures.push(`${leg}: ${msg}`); };
      const shot = (state) => process.env.KEYS_SHOTS
        ? page.screenshot({ path: `${process.env.KEYS_SHOTS}/grant-${width}-${dark ? 'dark' : 'light'}-${state}.png` })
        : Promise.resolve();
      await page.locator('#panel-keys tbody tr:last-child td:last-child button').click();
      await page.getByRole('menuitem', { name: /Grant scope/ }).click();
      await page.locator('dialog[open][data-testid="grant-scope-dialog"]').waitFor();

      // attention:deliver — the default scope asks for no host, and the
      // dialog (with its backdrop) fits the viewport at every width.
      const deliver = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]');
        const b = d.getBoundingClientRect();
        return {
          left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth, vh: innerHeight,
          backdrop: getComputedStyle(d, '::backdrop').backgroundColor,
          title: d.querySelector('#grant-scope-title')?.textContent ?? '',
          preview: d.querySelector('span.font-mono')?.textContent ?? '',
          host: !!d.querySelector('input[name="hostId"]'),
          overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
        };
      });
      check(deliver.title === 'Grant a scope', `dialog title "${deliver.title}"`);
      check(deliver.preview === PREVIEWS[2], `dialog shows the row's key "${deliver.preview}", not ${PREVIEWS[2]}`);
      check(!deliver.host, 'attention:deliver shows a host field');
      check(deliver.left >= -0.5 && deliver.right <= deliver.vw + 0.5, `dialog escapes the viewport horizontally (${deliver.left.toFixed(1)}..${deliver.right.toFixed(1)} of ${deliver.vw})`);
      check(deliver.top >= -0.5 && deliver.bottom <= deliver.vh + 0.5, `dialog escapes the viewport vertically (${deliver.top.toFixed(1)}..${deliver.bottom.toFixed(1)} of ${deliver.vh})`);
      check(deliver.backdrop !== 'rgba(0, 0, 0, 0)', `backdrop is not dimmed (${deliver.backdrop})`);
      check(deliver.overflow <= 0, `page overflows horizontally by ${deliver.overflow}px`);
      await shot('deliver');

      // host:operate — the host field appears with its helper text UNDER the
      // field (the label stays a plain label).
      await page.selectOption('dialog[open] select[name="scope"]', 'host:operate');
      const operate = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]');
        const input = d.querySelector('input[name="grant-host"]') ?? d.querySelector('input[name="hostId"]');
        const label = d.querySelector('label[for="grant-host"]');
        const helper = input.nextElementSibling;
        const ib = input.getBoundingClientRect(), lb = label.getBoundingClientRect(), hb = helper.getBoundingClientRect();
        return {
          inputW: ib.width, inputTop: ib.top, inputBottom: ib.bottom,
          labelBottom: lb.bottom, helperTop: hb.top, helperText: helper.textContent,
          label: label.textContent.trim(),
        };
      });
      check(operate.label === 'Host', `host label is "${operate.label}", not the plain "Host"`);
      check(operate.labelBottom <= operate.inputTop + 0.5, 'host label is not above the field');
      check(operate.helperTop >= operate.inputBottom - 0.5, 'helper text is not under the field');
      check(operate.helperText.includes('A host key reaches one host.'), `helper text "${operate.helperText}"`);
      check(operate.inputW >= 180, `host field ${operate.inputW.toFixed(1)}px < 180px`);
      await shot('operate');

      // The empty-host refusal: client validation cancels the submit, the
      // server's place is taken by the local sentence, the dialog STAYS open
      // and the submit never locks on "Granting…". The harness aliases
      // $app/forms to the recorder stub (a real click is inert by design —
      // kit is not there), so this drives superforms' own recorded submit
      // callback the way kit would, then flushes the macrotask superforms
      // renders its validation on.
      const refusal = await page.evaluate(async () => {
        const { submitEnhanced } = await import('/src/lib/test/stubs/app-forms.ts');
        const d = document.querySelector('dialog[open]');
        const { cancelled } = await submitEnhanced(d.querySelector('form'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const alert = d.querySelector('[data-testid="grant-scope-error"]');
        const ab = alert.getBoundingClientRect(), db = d.getBoundingClientRect();
        const submit = [...d.querySelectorAll('button')].find((b) => b.type === 'submit');
        return {
          cancelled, text: alert.textContent, open: d.open, disabled: submit.disabled,
          within: ab.left >= db.left - 0.5 && ab.right <= db.right + 0.5,
          overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
        };
      });
      check(refusal.cancelled, 'the empty-host grant was not cancelled client-side');
      check(refusal.open, 'the dialog closed on the refused submit');
      check(refusal.text.includes('Name the host this key may operate.'), `refusal text "${refusal.text}"`);
      check(refusal.within, 'the refusal text escapes the dialog box');
      check(!refusal.disabled, 'the submit stuck on "Granting…"');
      check(refusal.overflow <= 0, `page overflows horizontally by ${refusal.overflow}px`);
      await shot('refusal');
      check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    } finally { await page.close(); }
  }

  // List chrome still works on the widened table (once, at desktop).
  if (WIDTHS.includes(1440)) {
    const { page } = await open(browser, origin, css, { width: 1440, dark: false, state: 'default' });
    try {
      const rows = () => page.locator('#panel-keys tbody tr').count();
      await page.locator('#panel-keys [data-testid="table-header-toggle"]').click();
      const search = page.getByRole('textbox', { name: 'Search app keys' });
      await search.fill('router');
      await page.waitForFunction(() => document.querySelectorAll('#panel-keys tbody tr').length === 1);
      assert.equal(await rows(), 1);
      await search.fill('');
      await page.waitForFunction(() => document.querySelectorAll('#panel-keys tbody tr').length === 3);
      assert.ok(await page.locator('#panel-keys [data-testid="table-footer"]').count() === 1, 'pagination footer present');
      assert.ok(await page.locator('#panel-keys [data-testid="table-header"]').locator('summary').filter({ hasText: /Columns/ }).count() === 1, 'column toggle present');
      const header = await page.evaluate(() => { const h = document.querySelector('#panel-keys [data-testid="table-header"]').getBoundingClientRect(); const s = document.querySelector('#panel-keys [data-testid="data-table-scroller"]').getBoundingClientRect(); return { h: h.width, s: s.width }; });
      assert.ok(near(header.h, header.s), `open table header ${header.h}px matches the table ${header.s}px`);
      const label = page.locator('#panel-keys th').filter({ hasText: /^Label/ });
      await label.click();
      assert.ok(['ascending', 'descending'].includes(await label.getAttribute('aria-sort')), 'Label header sorts');
    } catch (e) { failures.push(`1440/chrome: ${e.message}`); } finally { await page.close(); }

    // A deliberately wide saved view keeps its widths and scrolls; nothing clamps it.
    const wide = await open(browser, origin, css, { width: 1440, dark: false, state: 'default', savedView: { label: 700, scopes: 400 } });
    try {
      const g = await wide.page.evaluate(() => {
        const s = document.querySelector('#panel-keys [data-testid="data-table-scroller"]');
        const th = [...s.querySelectorAll('th')].find((t) => t.textContent.trim().startsWith('Label'));
        return { label: th.getBoundingClientRect().width, scroll: s.scrollWidth, client: s.clientWidth, pageOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth };
      });
      if (!near(g.label, 700)) failures.push(`1440/saved-wide: Label column ${g.label}px, saved 700px`);
      if (!(g.scroll > g.client)) failures.push('1440/saved-wide: wide saved view does not scroll internally');
      if (g.pageOverflow > 0) failures.push(`1440/saved-wide: page overflows by ${g.pageOverflow}px`);
      const r = await wide.page.evaluate(reach, 'tbody tr:last-child td:last-child button');
      if (!(r.found && r.left >= -1 && r.right >= -1)) failures.push('1440/saved-wide: actions not reachable');
    } finally { await wide.page.close(); }
  }
} finally {
  await browser?.close();
  await server.close();
}

if (mutantName && !mutantApplied) throw new Error(`mutant ${mutantName} never reached the page source`);
for (const msg of lateOptimizations) failures.push(`vite re-optimized dependencies mid-run (cold cache?): ${msg}`);
if (failures.length) {
  console.error(`FAIL (${failures.length})${mutantName ? ` with mutant ${mutantName}` : ''}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`PASS: app keys layout${mutantName ? ` (mutant ${mutantName} survived!)` : ''} — ${WIDTHS.length} widths × 2 themes × ${STATES.length} states + grant dialog (${WIDTHS.length} widths × 2 themes × deliver/operate/refusal)`);
if (mutantName) process.exit(2);
