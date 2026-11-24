// portal#2509: the memory share page's "Shared by" cell keeps its name and URN chip inside the cell.
// Real Chromium, compiled app CSS, the REAL /app/memories/[id]/share/+page.svelte, synthetic data only
// (src/lib/test/fixtures/memory-shares-cell-harness.ts). A 64-character grantor name plus a URN chip
// escaped by up to 48px at 390px before the PartyLabel containment stack (#2506) was applied.
//
// Run:   pnpm test:memory-shares-granted-by-layout
// Knobs: SHARES_MUTANT=<name> (apply one source mutant; the run must FAIL), SHARES_SHOTS=<dir>.
// Exit codes: 0 pass; 1 an assertion failed (with a mutant: KILLED, the wanted result); 2 a mutant
// SURVIVED; 3 the run itself is unsound (bad knob, a mutant that did not apply, a reload under a leg).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
import { probeSrOnlyAnchors } from './lib/cell-escape-probe.mjs';

const CHIP = /<span class="block max-w-full min-w-0"><Urn value=\{row\.grantorUrn\} type="user" size=\{8\} compact \/><\/span>/;
const STACK = /<div class="flex max-w-full min-w-0 flex-col">/;
const MUTANTS = {
  // main's markup before the fix: a row with no bounded wrapper around the chip
  'pre-fix': [[STACK, '<div class="flex min-w-0 items-center gap-2">'], [CHIP, '<Urn value={row.grantorUrn} type="user" size={8} compact />']],
  // the column back to 160px: too narrow for the chip's touch targets
  'narrow-column': [[/('Shared by'\),\s*size: )200/, (_, head) => `${head}160`]],
  // NOT mutants: dropping the stack's own `max-w-full` or the chip wrapper survives, because the Urn root
  // already carries `min-w-0 max-w-full` and a column flex stretches its children. They are kept for
  // fidelity to PartyLabel (#2506), not because a measurement needs them.
};
const mutantName = process.env.SHARES_MUTANT ?? null;
const UNSOUND = 3;
const unsound = (msg) => { console.error(`UNSOUND: ${msg}`); process.exit(UNSOUND); };
if (mutantName && !MUTANTS[mutantName]) unsound(`SHARES_MUTANT must be one of ${Object.keys(MUTANTS).join(', ')}`);
let mutantApplied = false;
let mutantFailure = null;
const PAGE = /\/routes\/app\/memories\/\[id\]\/share\/\+page\.svelte$/;
const stub = (name) => resolve('src/lib/test/stubs', name);
const HARNESS = '/src/lib/test/fixtures/memory-shares-cell-harness.ts';

const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-memory-shares-layout',
  optimizeDeps: { entries: ['src/lib/test/fixtures/memory-shares-cell-harness.ts'], exclude: ['sveltekit-superforms'] },
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
  // The mutant plugin runs BEFORE svelte() so its patterns match the page's source, not the compiled module.
  plugins: [{
    name: 'memory-shares-mutant',
    enforce: 'pre',
    transform(code, id) {
      if (!mutantName || !PAGE.test(id.split('?')[0])) return null;
      let out = code;
      for (const [from, to] of MUTANTS[mutantName]) {
        if (!from.test(out)) { mutantFailure = `mutant ${mutantName} did not apply: ${from}`; throw new Error(mutantFailure); }
        out = out.replace(from, typeof to === 'function' ? to : () => to);
      }
      mutantApplied = true;
      return out;
    },
  }, tailwindcss(), svelte()],
});

const failures = [];
const opened = [];
let browser;
let thrown = null;

// Every element inside the grantedBy cell, measured against the cell's own box. Returns the largest
// right-edge overshoot in px, plus what the cell holds so a vacuous pass (no chip rendered) fails.
function measure() {
  const col = [...document.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim().startsWith('Shared by'));
  const td = document.querySelector('tbody tr').children[col];
  const box = td.getBoundingClientRect();
  const chip = td.querySelector('[data-testid="urn"], button, a, code, span.font-mono');
  let worst = 0;
  let worstEl = null;
  for (const el of td.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right - box.right > worst) { worst = r.right - box.right; worstEl = el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40); }
  }
  return { worst, worstEl, cellWidth: box.width, text: td.textContent.trim(), hasChip: Boolean(chip), nameTruncated: [...td.querySelectorAll('span.truncate')].some((s) => s.scrollWidth > s.clientWidth) };
}

const settle = (page) => page.evaluate(async () => {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  if (process.env.SHARES_SHOTS) await mkdir(process.env.SHARES_SHOTS, { recursive: true });
  for (const width of [390, 1280]) for (const dark of [false, true]) {
    const leg = `${width}/${dark ? 'dark' : 'light'}`;
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    opened.push(page);
    const errors = [];
    page.navigations = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.navigations += 1; });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
    await page.route('**/__shares_fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Shares fixture</title>' }));
    await page.route('**/api/**', (r) => (['fetch', 'xhr'].includes(r.request().resourceType()) ? r.fulfill({ contentType: 'application/json', body: '{}' }) : r.continue()));
    await page.goto(new URL('/__shares_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
      localStorage.clear();
      document.head.innerHTML = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>`;
      document.documentElement.classList.toggle('dark', dark);
      document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
      document.body.innerHTML = '<main><div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">'
        + '<aside class="sticky top-8 self-start w-48 shrink-0 flex-col hidden sm:flex" style="height: 600px"><nav class="text-sm">Sidebar</nav></aside>'
        + '<div class="min-w-0 flex-1" id="fixture"></div></div></main>';
    }, { css, dark });
    await page.evaluate(async (harness) => {
      const h = await import(/* @vite-ignore */ harness);
      window.stopShares = await h.mountSharesPage(document.getElementById('fixture'));
    }, HARNESS);
    await page.locator('tbody tr').first().waitFor();
    await settle(page);
    if (process.env.SHARES_SHOTS) await page.screenshot({ path: `${process.env.SHARES_SHOTS}/shares-${leg.replace('/', '-')}.png` });
    const m = await page.evaluate(measure);
    const check = (ok, msg) => { if (!ok) failures.push(`${leg}: ${msg}`); };
    check(m.hasChip, 'no URN chip rendered in the Shared by cell (a vacuous pass)');
    check(m.text.includes('G'.repeat(8)), `grantor name missing from the cell: ${m.text}`);
    check(m.worst <= 0.5, `Shared by content escapes its cell by ${m.worst.toFixed(1)}px (${m.worstEl}, cell ${m.cellWidth.toFixed(0)}px)`);
    // portal#2548: the Role <label class="sr-only"> in each row is anchored by its cell, never by the page.
    const sr = await page.evaluate(probeSrOnlyAnchors);
    check(sr.seen > 0, 'no sr-only label rendered in a cell, the anchor check measured nothing');
    check(sr.out.length === 0, `an sr-only label is not anchored inside its cell ${JSON.stringify(sr.out)}`);
    check(m.nameTruncated, 'the 64-character name did not truncate inside the cell');
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    console.log(`${leg}: cell ${m.cellWidth.toFixed(0)}px, overshoot ${m.worst.toFixed(1)}px`);
    await page.evaluate(() => window.stopShares?.());
  }
} catch (e) { thrown = e; } finally {
  for (const p of opened) if (p.navigations > 1) failures.unshift(`UNSOUND reload: ${p.navigations} navigations`);
  await browser?.close();
  await server.close();
}
if (mutantName && !mutantApplied) unsound(mutantFailure ?? `mutant ${mutantName} never applied`);
if (opened.some((p) => p.navigations > 1)) unsound('a page reloaded under a leg (late dependency optimisation); re-run');
if (thrown) { if (mutantName) { console.log(`KILLED ${mutantName}: ${thrown.message}`); process.exit(1); } console.error(thrown); process.exit(1); }
if (failures.length) { for (const f of failures) console.error(`FAIL ${f}`); if (mutantName) console.log(`KILLED ${mutantName}`); process.exit(1); }
if (mutantName) { console.error(`SURVIVED ${mutantName}`); process.exit(2); }
console.log('memory-shares granted-by layout: all legs pass');
