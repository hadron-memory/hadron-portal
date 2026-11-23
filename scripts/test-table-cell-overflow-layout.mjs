// #1942: real components/CSS, synthetic data only. No production or backend.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright';
import { parseHarnessEnv, injectionEcho, batteryFor, partyNarrowProbeNote, PARTY_NARROW_PROBE_WIDTH } from './lib/cell-harness-env.mjs';
import { sameMembers, pointerVerdict } from './lib/cell-harness-checks.mjs';
import { messages } from './lib/cell-harness-messages.mjs';
import { probeCellEscapes, ESCAPE_PX as CELL_ESCAPE_PX } from './lib/cell-escape-probe.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// portal#2129: every env knob is validated, and any active injection announced, before the dev server or a browser starts.
const env = parseHarnessEnv(process.env);
for (const line of injectionEcho(env)) console.log(line);
// The ONE kind-to-battery routing (blind review, #2507): every battery's kind
// list below is derived from this, never hand-written, so a single-kind run
// reaches exactly its own battery — pinned by the batteryFor table test.
const battery = batteryFor(env.cellKind);
// Each source patch must match, or the fixture would silently run unpatched components. A throw inside a
// Vite transform surfaces as a failed module load in the page, so the failure is also recorded here and
// asserted after the fixture mounts (assertPatched).
const patchFailures = [];
const patchFailure = message => { patchFailures.push(message); throw new Error(message); };
const patchSource = (code, id, from, to, required = true) => {
 if (!code.includes(from)) {
  if (required) patchFailure(`table-cell-fixture: source patch no longer matches in ${id}: ${from}`);
  return code;
 }
 return code.replaceAll(from, () => to);
};
const assertPatched = () => assert.deepEqual(patchFailures, [], 'every fixture source patch matched');
// portal#2490: route-page kinds mount real PAGES. Their module graph reaches
// `$app/*` and `$env/*` (no implementation outside a running SvelteKit app)
// and the node page's loader (`$lib/server/api` reads `$env/dynamic/private`;
// SvelteKit additionally forbids `$lib/server` in the client environment, so
// the loader runs node-side — see the pages battery). Specifiers are rewritten
// in transform, in EVERY module under src/ and in BOTH dev-server environments:
// resolver-hook ordering could not be relied on (SvelteKit's own $lib
// resolution answered first in the SSR graph, handing the loader a real
// GraphQLClient). `api`/`guards` are the browser equivalent of the vitest
// client lane's vi.mock: the loader's every request is answered by the
// harness's canned map. Same stub files that lane aliases to.
const STUB_SPECIFIERS = {
  '$app/navigation': 'app-navigation',
  '$app/environment': 'app-environment',
  '$app/stores': 'app-stores',
  '$app/state': 'app-state',
  '$app/forms': 'app-forms',
  '$env/dynamic/public': 'env-dynamic-public',
  '$lib/server/api': 'server-api',
  '$lib/server/guards': 'server-guards',
};
// Hoisted out of the transform hook, with a path-separator boundary: 'src'
// must be a prefix DIRECTORY, not a string prefix (a sibling like src-old
// would match without the separator) — blind review, #2507.
const srcRoot = path.resolve(__dirname, '../src') + path.sep;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
 name: 'table-cell-fixture', enforce: 'pre',
 transform(code, id) {
  // portal#2490: rewrite the no-browser specifiers everywhere under src/ (the
  // fixture's own page mounts, their transitive imports, and the node loader's
  // graph — the latter via the dev server's SSR environment). This subsumes the
  // per-component $app patches this plugin used to make (same stub files);
  // an $app/$env import the map does not know still fails loudly below — for
  // EVERY src/ module, AppRunsTable/TasksAlarms/AiServiceConfigManager included,
  // which is why their old dedicated re-check branch is gone: it re-tested the
  // already-rewritten code and so could never fire (blind review, #2507).
  // (\?.*)? on the extension (blind review #2507, fold): vite ids can carry a
  // query suffix (?svelte, ?v=…), and the bare anchored extension silently
  // skipped both the rewrite and the unpatched-import check for those ids.
  if (id.startsWith(srcRoot) && /\.(ts|svelte|js|mjs)(\?.*)?$/.test(id) && !id.includes('/.svelte-kit/') && !id.includes('/stubs/')) {
   let patched = code;
   for (const [from, to] of Object.entries(STUB_SPECIFIERS)) {
    patched = patched.replaceAll(`'${from}'`, `'$lib/test/stubs/${to}'`).replaceAll(`"${from}"`, `"$lib/test/stubs/${to}"`);
   }
   // A $app/ or $env/ import the map does not know would run unstubbed — in
   // its static AND dynamic forms (blind review #2507, fold): import('$app/forms')
   // escapes a from-only pattern.
   if (/from ['"]\$app\//.test(patched) || /import\(['"]\$app\//.test(patched)
    || /from ['"]\$env\//.test(patched) || /import\(['"]\$env\//.test(patched)) patchFailure(`table-cell-fixture: an unpatched $app/$env import is left in ${id}`);
   code = patched;
  }
  // Expose only the fixture's actual table objects, no production test API.
  if (id.endsWith('/createSvelteTable.svelte.ts')) code = patchSource(code, id, 'return createTable(withFeatures(options));', 'const fixtureTable = createTable(withFeatures(options)); globalThis.__fixtureTables ??= []; globalThis.__fixtureTables.push(fixtureTable); return fixtureTable;');
  return code;
 }
}] });
// A browser console error fails the run like a pageerror. The fixture has no favicon, so it is answered
// with an empty 204 instead of being allow-listed: every other failed resource is a real failure.
const watchErrors = async page => {
 const errors = [];
 await page.route('**/favicon.ico', r => r.fulfill({ status: 204 }));
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
 return errors;
};
// A page at the width under test, with touch + the pointer media feature
// PINNED, and a screenshot wrapper that RE-PINS after every shot. Root cause
// found on the node-page 390 legs (failed the same four legs on two full
// runs, passed in single-kind runs): Chromium's beyond-viewport capture —
// fullPage screenshots of tall pages — WIPES device emulation (pointer media
// feature AND touch both read gone afterwards). The node pages at 390 are the
// tallest legs, so only their post-screenshot pointer-mode assert tripped.
// Screenshots go through __cellShot so the emulation the oracle assumes is
// restored before the next check; the asserts stay.
// CELL_BROWSER (blind F2, PR #2538): the pin speaks CDP, which only Chromium
// offers — on Firefox/WebKit the call below dies with a Playwright stack trace
// mid-run (viewed: f2-firefox-alarms.log). The party-label battery is the
// cross-engine surface (it creates its own pin-free pages), so a non-Chromium
// engine is refused HERE, naming the scope, instead of crashing wherever the
// warm-up or a leg happens to hit this line first.
const newEmulatedPage = async (browser, width) => {
 const coarse = width === 390;
 const engine = browser.browserType().name();
 if (engine !== 'chromium') throw new Error(`CELL_BROWSER=${engine} cannot run this leg: the pointer/touch emulation pin speaks CDP, which only Chromium offers. Cross-engine runs cover the party-label battery only (CELL_KIND=party-label — its legs pin nothing); drop CELL_BROWSER for everything else.`);
 const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: coarse });
 const cdp = await page.context().newCDPSession(page);
 const pin = async () => {
  if (coarse) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: coarse ? 'coarse' : 'fine' }] });
 };
 await pin();
 page.__cellShot = async opts => {
  const buf = await page.screenshot(opts);
  await pin();
  await page.evaluate(() => new Promise(res => requestAnimationFrame(() => res())));
  return buf;
 };
 return page;
};
// Unmount the fixture through its own teardown before the page closes, so a teardown error fails the run
// instead of being hidden by the closing page. A missing hook is itself a failure.
const unmountFixture = async page => {
 await page.evaluate(() => {
  if (typeof window.stopFixture !== 'function') throw new Error('the fixture exposes no stopFixture teardown');
  window.stopFixture(); window.stopFixture = undefined;
 });
 await settlePage(page);
};
// Pixel-strip oracle compares the SAME neighboring strip with source text
// visible/hidden; backgrounds, borders and neighboring content are identical.
// CONSUMES `net`: the caller-owned stylesheet that lets text paint outside its cell is removed here, because
// the final check is that the production containment stops the deliberate escape once it is gone. The caller
// must not remove it again and must add a fresh one before the next call.
async function pixelStrip(page, kind, net) {
 // portal#2490: the strip compares TEXT pixels, so webfonts must be loaded
 // first — under the wider module graph of the page-mount battery the font
 // sometimes landed between shots and the compare saw text/no-text instead
 // of visible/hidden. Fonts settled once, before any shot, is deterministic.
 await page.evaluate(() => document.fonts.ready);
 const column = kind === 'runs' ? 5 : 0;
 const cell = page.locator('tbody tr').first().locator('td').nth(column);
 const next = page.locator('tbody tr').first().locator('td').nth(column + 1);
 await cell.evaluate(td => { const scroller = td.closest('[data-testid="data-table-scroller"]'); scroller.scrollLeft += td.getBoundingClientRect().left - scroller.getBoundingClientRect().left - 20; });
 await next.evaluate(td => td.style.visibility = 'hidden');
 const r = await cell.boundingBox();
 const clip = { x: Math.ceil(r.x+r.width+2), y: Math.ceil(r.y+2), width: 32, height: Math.max(1,Math.floor(r.height-4)) };
 assert.ok(clip.x+clip.width < (await page.viewportSize()).width, 'strip inside viewport');
 const pixels = async buffer => page.evaluate(async data => {
  const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
  const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0); return Array.from(ctx.getImageData(0,0,image.width,image.height).data);
 }, buffer.toString('base64'));
 const compare = async () => {
  await cell.evaluate(td => td.style.visibility='hidden');
  const baseline = await pixels(await page.screenshot({clip}));
  await cell.evaluate(td => td.style.visibility='visible');
  const visible = await pixels(await page.screenshot({clip}));
  return visible.reduce((n,x,i)=>n+(x!==baseline[i]?1:0),0);
 };
 const clean = await compare();
 assert.equal(clean,0,`${kind}: repaired text paints no neighboring pixels with net OFF`);
 // A deliberately uncontained version of THIS real cell must paint into the
 // same strip, proving the crop/oracle can see the defect.
 const control = await page.addStyleTag({content:'td[data-paint-control] {white-space:nowrap !important} td[data-paint-control] * {white-space:nowrap !important; overflow:visible !important; text-overflow:clip !important}'});
 await cell.evaluate(td => {td.setAttribute('data-paint-control','');const n=document.createElement('span');n.dataset.negativeText='';n.textContent='W'.repeat(100);td.append(n);});
 const dirty = await compare();
 assert.ok(dirty>0,`${kind}: uncontained negative control paints neighboring strip`);
 await net.evaluate(el=>el.remove());
 const contained = await compare();
 assert.equal(contained,0,`${kind}: production net stops deliberate uncontained control`);
 await cell.evaluate(td=>{td.querySelector('[data-negative-text]')?.remove();td.removeAttribute('data-paint-control');td.style.visibility=''});
 await next.evaluate(td=>td.style.visibility=''); await control.evaluate(el=>el.remove());
 return {clean,negativeControlChangedChannels:dirty,netOnChangedChannels:contained};
}
// Fonts first (portal#2125 item 5), but bounded: a font that never settles must not stall a leg forever.
const settlePage = page => page.evaluate(async () => {
 await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]);
 await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
// Glyph pixels outside the owning cell that count as an escape (sub-pixel rounding stays below it).
const ESCAPE_PX = 0.5;
// The strict no-clipping oracle applies from this measured width up (blind review, #2507, named):
// the sizing legs hold every declared minimum at 120px (the drag legs assert aria-valuemin >= 120),
// so 119px is that floor within 1px of sub-pixel tolerance — narrower restored text columns are
// intentionally recoverable by widening instead (the 40px legs).
const STRICT_CELL_MIN_PX = 119;
const flaggedCell = x => x.width >= STRICT_CELL_MIN_PX && (x.scroll > x.client + 1 || x.badGlyphs.length > 0);
// Shared td-level oracle — glyph boxes of UNCLIPPED text vs the owning td, plus scroll-vs-client
// (unioned from main's #2501, which introduced the wake pass that shares it). evaluateAll callbacks
// cannot close over Node scope and Playwright refuses functions as evaluate arguments, so this one
// definition is injected into the page once per leg (the battery setups below) as
// window.__tdGeometry and every leg's oracle calls it there — the definitions cannot drift apart.
const tdGeometry = td => {
 const rect = td.getBoundingClientRect();
 const badGlyphs = [];
 const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
 for (let n; (n = walker.nextNode());) {
  if (!n.textContent.trim()) continue;
  let clipped = false;
  for (let a = n.parentElement; a && a !== td; a = a.parentElement) {
   const st = getComputedStyle(a);
   if (st.textOverflow === 'ellipsis' || st.position === 'absolute' || st.position === 'fixed' || st.overflow === 'hidden') clipped = true;
  }
  if (clipped) continue;
  const range = document.createRange(); range.selectNodeContents(n);
  for (const r of range.getClientRects()) if (r.left < rect.left - .5 || r.right > rect.right + .5) badGlyphs.push(n.textContent.slice(0, 40));
 }
 return { width: rect.width, scroll: td.scrollWidth, client: td.clientWidth, badGlyphs };
};
let browser;
const failures = [];
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('/src/app.css?direct', origin))).text();
 // CELL_BROWSER picks the engine (chromium|firefox|webkit) so the flex
 // give-way legs can run outside Chromium (blind F2, PR #2538); the default
 // is unchanged. Scope: only the party-label battery runs cross-engine —
 // every other leg pins pointer/touch emulation over CDP (Chromium-only) and
 // newEmulatedPage refuses a non-Chromium engine by name.
 const CELL_BROWSER = process.env.CELL_BROWSER ?? 'chromium';
 browser = await ({ chromium, firefox, webkit })[CELL_BROWSER].launch({ headless: true });
 // portal#2490: warm the CLIENT dep optimizer with the six page graphs before
 // any timed leg. The pages' dynamic imports are only discovered at request
 // time (the fixture's stub rewrite runs in the transform pipeline, which the
 // dep scanner does not see), and vite's first discovery of a new dependency
 // re-optimizes and force-reloads the page — destroying the mount evaluate's
 // execution context mid-import. Seen exactly once per cold cache, on the
 // first page leg. Warming on a throwaway page makes that reload happen here.
 // Only the pages battery needs it (blind review, #2507): a component-kind or
 // findings/agent-tasks run never mounts a page graph.
 if (battery.pages.length) {
  const warm = await newEmulatedPage(browser, 1280);
  await warm.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>warm</title>' }));
  await warm.goto(new URL('/__cell_fixture', origin).href);
  // A mid-import optimizer reload can kill this evaluate and resolve
  // waitForLoadState immediately (blind review, #2507), so retry the imports
  // once after a settle — post-reload they resolve against the optimized deps.
  // The SETTLED RESULTS are judged, and a warm-up whose imports still reject
  // after the retry FAILS the run (blind review #2507, fold): allSettled
  // RESOLVES even when every import rejects, so the old boolean "did the
  // evaluate survive" could never see a typo'd or removed path — a no-op
  // warm-up silently reintroduces the flake this block exists to prevent.
  const imports = () => warm.evaluate(async () => {
   const rs = await Promise.allSettled([
    import('/src/routes/app/agents/+page.svelte'),
    import('/src/routes/app/memories/+page.svelte'),
    import('/src/routes/app/agents/[id]/+page.svelte'),
    import('/src/routes/app/agents/[id]/page-fixture'),
    import('/src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte'),
    import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'),
   ]);
   return rs.filter(r => r.status === 'rejected').map(r => String(r.reason));
  }).catch(err => [`the warm-up evaluate itself failed: ${String(err)}`]);
  await imports();
  await warm.waitForLoadState('load').catch(() => {});
  const rejected = await imports();
  if (rejected.length) failures.push(`warm-up: page-graph imports still rejecting after the settle retry — the first page leg would hit the mid-import optimizer reload this block exists to prevent: ${rejected.join(' | ')}`);
  await warm.close();
 }
 if (process.env.CELL_SHOTS) await mkdir(process.env.CELL_SHOTS, { recursive: true });
 const cellWidth = env.cellWidth;
 const widths = cellWidth !== null ? [cellWidth] : [390, 1280];
 // The component battery's kinds come from the one routing table above — never
 // a hand-written list (blind review, #2507): a page kind belongs to the pages
 // battery below, findings and agent-tasks to their own.
 const componentKinds = battery.component;
 for (const width of widths) for (const dark of [false, true]) for (const kind of componentKinds) {
  const page = await newEmulatedPage(browser, width);
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  await page.route('**/api/ai-configs', r => r.fulfill({ contentType: 'application/json', body: '{"endpoints":[]}' }));
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async kind => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = await mountOverflowFixture(document.getElementById('fixture'), kind); }, kind);
   // One-shot injection is sound because no leg reloads or navigates after setup (portal#2501 BLIND
   // P3): every later evaluate lands on the same document. A navigating leg needs addInitScript instead.
   await page.evaluate(`window.__tdGeometry = ${tdGeometry.toString()}`);
   await page.locator('tbody td').first().waitFor();
   if (kind === 'alarms') {
    const action = await page.locator('form').first().getAttribute('action');
    const target = new URL(action, page.url());
    assert.equal(target.searchParams.get('alarmBefore'), 'fixture-page-boundary', 'Alarms fixture supplies the current route slice to the real native form');
    assert.equal(target.searchParams.getAll('/acknowledgeAlarm').length, 1, 'one intended named action');
   }
   if (process.env.CELL_SHOTS) await page.__cellShot({path:`${process.env.CELL_SHOTS}/${kind}-${width}-${dark?'dark':'light'}-default.png`,fullPage:true});
   assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), width === 390, 'actual pointer mode');
   let net = await page.addStyleTag({ content: 'td { overflow: visible !important; }' });
   for (const zoom of [1, 2]) {
    const textZoom = zoom === 2 ? await page.addStyleTag({ content: 'td {font-size:28px} td span, td a, td code, td button {font-size:inherit !important}' }) : null;
    for (const sizing of ['default', 'double', 'minimum', 'restored']) {
     await page.evaluate(async sizing => {
      const t = window.__fixtureTables.at(-1);
      if (sizing === 'restored') {
       const { applyView, normalizeView } = await import('/src/lib/table/savedView.ts');
       applyView(t, normalizeView({ columnSizing: Object.fromEntries(t.getAllLeafColumns().map(c => [c.id, 1])) }));
      } else t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c => [c.id, sizing === 'double' ? (c.columnDef.size ?? 150) * 2 : sizing === 'minimum' ? Math.max(120, c.columnDef.minSize ?? 40) : (c.columnDef.size ?? 150)])));
     }, sizing);
     await settlePage(page);
     // At 40px, noninteractive text is intentionally recoverable by widening.
     // The STRICT_CELL_MIN_PX and wider oracle is strict: no clipping may mask a repair.
     const geometry = await page.locator('tbody td').evaluateAll(cells => cells.map(td => ({ text: td.textContent.slice(0, 50), ...window.__tdGeometry(td) })));
     const overflow = geometry.filter(flaggedCell);
     if (overflow.length) failures.push(`${kind}/${width}/${dark}/${zoom}/${sizing}: net-off ${JSON.stringify(overflow)}`);

     assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${kind}/${width}/${dark}/${zoom}/${sizing}: internal scroller, not document overflow ${await page.evaluate(()=>document.documentElement.scrollWidth)}`);
    }
    await textZoom?.evaluate(el => el.remove());
   }
   const narrowPaint = await pixelStrip(page,kind,net); // actual restored 40px text-only columns
   net = await page.addStyleTag({content:'td {overflow:visible !important}'});
   await page.evaluate(() => { const t=window.__fixtureTables.at(-1); t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c=>[c.id,Math.max(120,c.columnDef.minSize??40)]))); });
   await settlePage(page);
   const paint = await pixelStrip(page,kind,net);
   assert.equal(await net.evaluate(el => el.isConnected), false, `${kind}: pixelStrip consumed the net-off stylesheet, so the controls below run contained`);
   // Real keyboard minima and drag, including a restored one-pixel view.
   const interactive = kind === 'runs' ? 'actions' : kind === 'config' ? 'actions' : 'status';
   await page.evaluate(id=>{const t=window.__fixtureTables.at(-1);t.setColumnOrder([id,...t.getAllLeafColumns().map(c=>c.id).filter(x=>x!==id)]);},interactive); await settlePage(page);
   if (kind === 'config' && width === 390) {
    // Main #1950 pins the phone action column at170px and intentionally
    // removes its resize handle. Preserve that behavior in this merge.
    const actionHeader = page.getByRole('columnheader',{name:'Actions',exact:true});
    assert.equal(await actionHeader.getByRole('separator').count(),0,'phone sticky actions are not resizable');
    const actualWidth=(await actionHeader.boundingBox()).width;
    assert.ok(Math.abs(actualWidth-170)<=1,'phone sticky action column stays170px');
   } else {
   const header = page.locator('th');
   const index = await page.evaluate(id => window.__fixtureTables.at(-1).getVisibleLeafColumns().findIndex(c => c.id === id), interactive);
   const separator = header.nth(index).getByRole('separator');
   await separator.scrollIntoViewIfNeeded(); await separator.focus();
   const minimum = Number(await separator.getAttribute('aria-valuemin'));
   assert.ok(minimum >= 120, 'interactive declared minimum exposed');
   await page.keyboard.press('ArrowLeft');
   assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum);
   await page.keyboard.press('ArrowRight');
   assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum + 10);
   await settlePage(page);
   const box = await separator.boundingBox();
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await settlePage(page);
   assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum, 'native drag cannot cross declared minimum');
   }
   // net ON: pixelStrip above consumed (removed) the net-off stylesheet, so the controls below run contained.
   const target = kind === 'config' ? page.getByRole('button', { name: /Actions for LongConfigName/ }).nth(1) : kind === 'runs' ? page.locator('tbody').getByRole('link', { name: 'Open', exact: true }) : page.locator('tbody').getByRole('button', { name: 'Copy the command that acknowledges this alarm' });
   await target.scrollIntoViewIfNeeded(); await target.focus();
   const control = await target.evaluate(el => {
    const r=el.getBoundingClientRect(), c=el.closest('td').getBoundingClientRect();
    return { width:r.width, height:r.height, ringInside:r.left-4>=c.left && r.right+4<=c.right && r.top-4>=c.top && r.bottom+4<=c.bottom };
   });
   assert.ok(control.height >= 44 && control.width >= 44, 'action44px in both dimensions');
   assert.ok(control.ringInside, 'four-pixel focus margin inside cell');
   // UX F1/F2: real rem scaling also scales padding and rem-based targets.
   // A td-only font override cannot prove the 200% interactive floor.
   if (kind === 'runs' || kind === 'alarms') {
    const remZoom = await page.addStyleTag({content:'html {font-size:32px !important}'});
    // Keep the grid wider than its scroller so auto table distribution cannot
    // enlarge the declared minimum and hide a clipped ring.
    await page.evaluate(id=>{const t=window.__fixtureTables.at(-1);t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c=>[c.id,c.id===id?1:(c.columnDef.size??150)*2])));},interactive);
    await settlePage(page); await target.scrollIntoViewIfNeeded(); await target.focus();
    const enlarged = await target.evaluate(el => {
     const r=el.getBoundingClientRect(), c=el.closest('td').getBoundingClientRect();
     const range=document.createRange(); range.selectNodeContents(el);
     return {width:r.width,height:r.height,left:r.left-c.left,right:c.right-r.right,
      top:r.top-c.top,bottom:c.bottom-r.bottom,labelLines:range.getClientRects().length};
    });
    console.log('rem-control',kind,width,dark,enlarged);
    if (enlarged.left<4 || enlarged.right<4 || enlarged.top<4 || enlarged.bottom<4)
     failures.push(`${kind}/${width}/${dark}: real-rem 200% focus margin ${JSON.stringify(enlarged)}`);
    if (kind==='runs' && enlarged.labelLines!==1)
     failures.push(`${kind}/${width}/${dark}: real-rem 200% Open label wraps ${JSON.stringify(enlarged)}`);
    await remZoom.evaluate(el=>el.remove()); await settlePage(page);
   }
   await target.click({ trial:true });
   if (kind === 'config') {
    await target.click();
    const edit = page.getByRole('menuitem', { name:'Edit',exact:true }); await edit.click({trial:true});
    await page.keyboard.press('Escape'); assert.equal(await target.evaluate(el=>el===document.activeElement),true,'Escape returns focus');
    await target.click(); await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
    await page.locator('#ac-name').waitFor();
    // Real manager native select, not a synthetic HTML lookalike.
    const provider = page.locator('#ac-provider'); await provider.selectOption('openai'); assert.equal(await provider.inputValue(),'openai');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await target.click(); await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
    const row = page.locator('tbody tr').filter({hasText:'LongConfigNameWithFortyUnbrokenCharacters1'});
    await row.getByText('Delete the “LongConfigNameWithFortyUnbrokenCharacters1” configuration? This cannot be undone.',{exact:true}).waitFor();
    const confirmationCell = row.locator('td').filter({has:page.getByText('Delete the “LongConfigNameWithFortyUnbrokenCharacters1” configuration? This cannot be undone.',{exact:true})});
    assert.equal(await confirmationCell.getByText('Delete the “LongConfigNameWithFortyUnbrokenCharacters1” configuration? This cannot be undone.',{exact:true}).count(),1,'clipping oracle inspects the actual confirmation cell after reorder');
    const confirmationOverflows = () => confirmationCell.evaluate(td=>td.scrollWidth>td.clientWidth+1);
    assert.equal(await confirmationOverflows(),false,'inline confirmation not clipped');
    // Prove this same oracle detects overflowing content in the confirmation
    // cell, rather than passing against an unrelated text column.
    await confirmationCell.evaluate(td=>{const n=document.createElement('span');n.dataset.confirmationNegative='';n.style.whiteSpace='nowrap';n.textContent='W'.repeat(100);td.append(n);});
    assert.equal(await confirmationOverflows(),true,'confirmation overflow negative control is detected');
    await confirmationCell.locator('[data-confirmation-negative]').evaluate(el=>el.remove());
    assert.equal(await confirmationOverflows(),false,'confirmation is clean after negative control cleanup');
    await row.getByRole('button',{name:'Cancel',exact:true}).click();
   } else if (kind === 'alarms') {
    await page.evaluate(()=>{window.copied=[]; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.copied.push(value)}})});
    await target.click(); assert.deepEqual(await page.evaluate(()=>window.copied),['hadron team alarm ack fixture-alarm']);
   } else {
    assert.equal(await target.getAttribute('href'),'/app/apps/fixture/runs/fixture-run');
    const copy = page.getByRole('button',{name:'Copy URN',exact:true});
    await page.evaluate(()=>{window.copied=[]; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.copied.push(value)}})});
    await copy.scrollIntoViewIfNeeded(); await copy.click(); assert.deepEqual(await page.evaluate(()=>window.copied),['hrn:node:example.test:fixture:forty-character-unbroken-loc-ABCDEFGHIJKLMN']);
    if (width===390) {const reveal=page.getByRole('button',{name:/Show full URN/}); await reveal.click(); assert.equal(await reveal.getAttribute('aria-expanded'),'true');}
   }
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${kind}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   assert.deepEqual(errors, [], 'no browser errors');
   console.log(`${kind}/${width}/${dark ? 'dark' : 'light'}: completed 8 sizing/text legs + native controls/menu/minimum`,{paint,narrowPaint});

  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/FAILED-${kind}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }
 // portal#2118 item 5: the findings table has no interactive column, so it gets its own geometry pass.
 // Severity (six revealed markers, and an 80-character plain label) and text stay inside their cells
 // (#2115 QA F1, #2119). The control strips severity's wrap and must see the overflow.
 if (battery.findings.length) for (const width of widths) for (const dark of [false, true]) {
  const page = await newEmulatedPage(browser, width);
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `findings/${width}/${dark ? 'dark' : 'light'}`;
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async () => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = await mountOverflowFixture(document.getElementById('fixture'), 'findings'); });
   // Bounded: no severity field at all is a loud abort (a thrown timeout), not a hang.
   await page.locator('[data-testid="finding-severity"]').first().waitFor({ timeout: 10000 });
   // Fonts first: a late webfont would change the measured glyph boxes (portal#2125 item 5).
   // CELL_INJECT_MISSING_TRIGGER=1 removes one severity trigger to prove a missing trigger is one failure, not a cascade.
   if (env.injectMissingTrigger) await page.locator('[data-testid="finding-severity"]').last().evaluate(el => el.remove());
   // Snapshot before ANY check on this leg, so a failure queued by the pointer check below also gates the success line.
   const legFailuresBefore = failures.length;
   // The baseline is judged first and on its own; CELL_INJECT_POINTER_FAILURE=1 only fires on a correct baseline (portal#2129 row 7).
   failures.push(...pointerVerdict({ width, actualCoarse: await page.evaluate(() => matchMedia('(pointer: coarse)').matches), inject: env.injectPointerFailure }).map(m => `${leg}: ${m}`));
   // Pixels of glyph box outside the owning td, per field: horizontal AND vertical (portal#2125 item 4).
   const escapes = () => page.locator('tbody td [data-testid^="finding-"]').evaluateAll(fields => fields.map(f => {
    const cell = f.closest('td').getBoundingClientRect(); let px = 0;
    const range = document.createRange(); range.selectNodeContents(f);
    for (const r of range.getClientRects()) px = Math.max(px, cell.left - r.left, r.right - cell.right, cell.top - r.top, r.bottom - cell.bottom);
    return { field: f.dataset.testid, row: f.closest('tr').querySelector('[data-testid="finding-id"]').textContent, px: Math.round(px) };
   }));
   // One failure strategy: the measured checks on this leg queue into `failures`, so a failing check does not stop the other legs.
   await settlePage(page);
   const clean = await escapes();
   const severityCount = clean.filter(x => x.field === 'finding-severity').length;
   // One cause, one failure: with a trigger missing, the controls below have nothing to measure, so they are skipped.
   if (severityCount !== 2) failures.push(messages.severityFields(leg, severityCount));
   else {
    const out = clean.filter(x => x.px > ESCAPE_PX);
    if (out.length) failures.push(`${leg}: findings field escapes its cell ${JSON.stringify(out)}`);
    const control = await page.addStyleTag({ content: '[data-testid="finding-severity"] { overflow-wrap: normal !important; word-break: normal !important; }' });
    await settlePage(page);
    const dirty = (await escapes()).filter(x => x.field === 'finding-severity' && x.px > ESCAPE_PX).map(x => x.row);
    if (!sameMembers(dirty, ['markers', 'plain'])) failures.push(messages.wrapControlMissed(leg, dirty));
    await control.evaluate(el => el.remove());
    // Second control, for the vertical terms of escapes(): text pushed below its cell must be seen to escape
    // vertically, or "both axes" is a claim the harness cannot fail (portal#2126 BLIND P2).
    // The geometry is set up and measured, not assumed: cells are forced taller than 400px, and the displacement
    // is the tallest measured cell plus 200px, so it clears the cell whatever the line-height or font.
    const tall = await page.addStyleTag({ content: 'tbody td { height: 700px; }' });
    await settlePage(page);
    const tallest = await page.locator('tbody td').evaluateAll(tds => Math.max(...tds.map(td => td.getBoundingClientRect().height)));
    if (!(tallest > 400)) failures.push(messages.verticalPrecondition(leg, tallest));
    else {
     const vertical = await page.addStyleTag({ content: `[data-testid="finding-text"] { position: relative; top: ${Math.ceil(tallest) + 200}px; }` });
     await settlePage(page);
     if ((await escapes()).filter(x => x.px > ESCAPE_PX).length === 0) failures.push(messages.verticalNotDetected(leg));
     await vertical.evaluate(el => el.remove());
    }
    await tall.evaluate(el => el.remove());
    await settlePage(page);
    if ((await escapes()).some(x => x.px > ESCAPE_PX)) failures.push(messages.verticalLeftEscape(leg));
   }
   // Independent of the severity triggers, so it still runs when one is missing.
   if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   // The success line only prints for a leg that queued nothing.
   if (failures.length === legFailuresBefore) console.log(`${leg}: severity and text inside their cells (both axes); negative control detected`, clean);
   else console.log(`${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`, clean);
  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }
 // portal#2489 (#1962 audit, slice 3; unioned from main's #2501 in the #2507 carry): the worker-wake
 // panels' two pinned cells — the apply receipt's Every (cadence plus the App's-floor label,
 // worker-wake:apply-created) and the subscriptions' Since (a full fmtRunTime timestamp,
 // worker-wake:subscriptions) — keep their content inside their cell with the full value reachable
 // (title reach needs a hover pointer; touch cannot hover — portal#2501 BLIND P3): the floor label
 // wraps in place (remedy a), the timestamp ellipsizes as a block with its full value in the title
 // (remedy b, the quiet cell's own shape). The oracle is the td-level one the sizing legs use (glyph
 // boxes of UNCLIPPED text), because an ellipsized cell is contained by its own overflow — so the
 // nowrap control strips overflow too, proving the oracle can still see this defect class rather
 // than passing against it.
 if (battery.wake.length) for (const width of widths) for (const dark of [false, true]) {
  const page = await newEmulatedPage(browser, width);
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `wake/${width}/${dark ? 'dark' : 'light'}`;
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async () => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = await mountOverflowFixture(document.getElementById('fixture'), 'wake'); });
   // One-shot injection is sound because no leg reloads or navigates after setup (portal#2501 BLIND P3).
   await page.evaluate(`window.__tdGeometry = ${tdGeometry.toString()}`);
   await page.locator('[data-testid="wake-since"]').first().waitFor({ timeout: 10000 });
   const legFailuresBefore = failures.length;
   await settlePage(page);
   // settlePage already settles fonts, bounded (portal#2125: a font that never
   // settles must not stall a leg forever). This explicit wait is the same
   // unbounded belt-and-braces the pages battery carries (blind review #2507,
   // delta fold): it covers the >5s tail before the glyph-rect oracle's
   // measured read, where a late webfont swap would queue a false escape.
   await page.evaluate(() => document.fonts.ready);
   // Per pinned cell: the owning td's geometry (the shared td-level oracle), plus the reachability
   // facts the acceptance names — the truncated timestamp's title, the wrapped label's text.
   // A field outside a td (markup change) is a loud named failure, not a TypeError out of the oracle
   // (portal#2501 BLIND P3) — the same treatment the missing-scroller check gives its null below.
   const cellState = () => page.locator('[data-testid="wake-since"], [data-testid="wake-apply-every"]').evaluateAll(fields => fields.map(f => { const td = f.closest('td'); return { field: f.dataset.testid, ...(td === null ? { td: null } : window.__tdGeometry(td)), title: f.getAttribute('title'), text: f.textContent.trim() }; }));
   const clean = await cellState();
   if (clean.length !== 2) failures.push(`${leg}: both pinned cells must render ${JSON.stringify(clean)}`);
   else {
    const tdMissing = clean.filter(x => x.td === null).map(x => x.field);
    if (tdMissing.length) failures.push(`${leg}: pinned cell has no td ancestor ${JSON.stringify(tdMissing)}`);
    const out = clean.filter(flaggedCell);
    if (out.length) failures.push(`${leg}: worker-wake cell escapes its cell ${JSON.stringify(out)}`);
    const since = clean.find(x => x.field === 'wake-since');
    if (!since || since.title !== since.text) failures.push(`${leg}: Since is missing its full value in a title ${JSON.stringify(since)}`);
    const every = clean.find(x => x.field === 'wake-apply-every');
    // The wrap remedy, not a hidden one: nothing between the Every field and its td may clip or ellipsize.
    const everyClipped = await page.locator('[data-testid="wake-apply-every"]').evaluate(el => {
     for (let a = el; a && a.tagName !== 'TD'; a = a.parentElement) { const st = getComputedStyle(a); if (st.textOverflow === 'ellipsis' || st.overflow === 'hidden') return true; }
     return false;
    });
    // 'min (' with a PLAIN space is the wording oracle on purpose: an &nbsp; there cannot break and
    // would silently regress the wrap remedy (portal#2501 BLIND P3).
    if (!every || everyClipped || !every.text.includes('min (')) failures.push(`${leg}: the floor label is not visible-and-wrapped in Every ${JSON.stringify(every)}`);
   }
   // Where the audit's default-size geometry binds — the table's own scroller scrolls, so columns hold
   // their declared sizes (a wider container spreads surplus and these cells fit by construction,
   // DataTable.svelte's max(100%, total) width model) — force the repaired cells back to uncontained
   // nowrap. Binding is PER CELL: the two cells sit in different tables with different column sets,
   // so at a width where only one scroller overflows, only that cell is forced to escape — asserting
   // the other would fail the control for the wrong reason (portal#2501 BLIND P2).
   const bindsByCell = await page.locator('[data-testid="wake-since"], [data-testid="wake-apply-every"]').evaluateAll(fields => Object.fromEntries(fields.map(f => {
    const s = f.closest('[data-testid="data-table-scroller"]');
    return [f.dataset.testid, s === null ? null : s.scrollWidth > s.clientWidth + 1];
   })));
   // A null is a markup change (no scroller ancestor): a loud named failure, not a TypeError on null.
   const scrollerMissing = Object.entries(bindsByCell).filter(([, binds]) => binds === null).map(([field]) => field);
   if (scrollerMissing.length) failures.push(`${leg}: pinned cell has no data-table-scroller ancestor ${JSON.stringify(scrollerMissing)}`);
   const boundCells = Object.entries(bindsByCell).filter(([, binds]) => binds === true).map(([field]) => field);
   // The audit's phone width must exercise the control (portal#2501 BLIND P3): a reverted fix could
   // otherwise hide behind widened geometry — legs green, control skipped, pass vacuous. Measured:
   // both pinned cells bind at 390 today; 1280 legitimately widens into the skip branch.
   if (width === 390 && !boundCells.length) failures.push(`${leg}: no pinned cell binds at 390 — widened geometry, the nowrap control never ran`);
   if (boundCells.length) {
    const control = await page.addStyleTag({ content: '[data-testid="wake-since"], [data-testid="wake-apply-every"] { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important }' });
    await settlePage(page);
    const dirty = (await cellState()).filter(flaggedCell).map(x => x.field);
    // Every cell whose scroller bound must be seen escaping. Extra flags are legitimate: forcing
    // nowrap can itself push a table from surplus-spread into binding, and that escape is the
    // control's own doing — the "left escapes behind" check below still gates a stuck page.
    const unflaggedBound = boundCells.filter(b => !dirty.includes(b));
    if (unflaggedBound.length) failures.push(`${leg}: nowrap control must flag the scroller-bound cells ${JSON.stringify({ bound: boundCells, flagged: dirty })}`);
    await control.evaluate(el => el.remove()); await settlePage(page);
    if ((await cellState()).some(flaggedCell)) failures.push(`${leg}: nowrap control left escapes behind`);
   }
   if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   if (failures.length === legFailuresBefore) console.log(`${leg}: every and since inside their cells, values present — title reach is hover-only, touch cannot hover${boundCells.length ? `; nowrap control flags ${boundCells.join(' and ')}` : ' (widened geometry: declared sizes do not bind, control skipped)'}`, clean);
   else console.log(`${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`, clean);
  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }
 // ══ portal#2490 (slice 4): route-pages battery ════════════════════════════
 // The same net-off geometry oracle and negative-control discipline as the
 // batteries above, run against the REAL route pages — the containment defect
 // lives in each page's own cell snippet, so the fixture mounts the page.
 // Findings-style: a failing check queues into `failures` and the leg's other
 // checks still run.
 // The node page's data comes from its REAL loader: SvelteKit forbids
 // `$lib/server` in the client environment, so the loader runs here, node-side,
 // in the dev server's SSR module graph — its gqlClient answered by the canned
 // map below, keyed by the same query constants the loader imports (the
 // browser-harness equivalent of the client lane's vi.mock). The loader's
 // streamed promises are awaited here and re-created browser-side by
 // mountLoadedNodePage, which is what a streamed navigation hands the client
 // once they land.
 const NODE_TABS = { 'node-properties': 'properties', 'node-history': 'history' };
 const nodeLoadedByKind = {};
 // `devServer`, not `server`: the name was shadowing the outer vite server the
// caller passes (blind review, #2507).
async function loadNodePageData(devServer, tab) {
  const loaderMod = await devServer.ssrLoadModule('/src/routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts');
  const queries = await devServer.ssrLoadModule('/src/lib/server/queries.ts');
  const comments = await devServer.ssrLoadModule('/src/lib/server/comments.ts');
  // Synthetic content — loaded FROM the fixture's own PAGE_FIXTURE_VALUES so
  // the canned map and the in-page pins cannot drift apart (blind review, #2507).
  const { PAGE_FIXTURE_VALUES: F } = await devServer.ssrLoadModule('/src/lib/test/fixtures/table-cell-overflow-harness.ts');
  const { LONG64, LONG_FIELD, LONG_LOC, LONG_TARGET_LOC, ID32, LONG_ACTOR, LONG_INFO, LONG_EDGE_NAME } = F;
  const AT = '2026-10-01T00:00:00Z';
  const NODE = {
   id: 'leaf-pk', memoryId: 'mem-A', loc: 'fixture-loc', name: 'Fixture Node', revision: 4,
   nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
   tokens: null, tags: [], seq: null, data: null, ownerRepo: null, isRunnable: false,
   objectType: 'competitor',
   properties: { [LONG_FIELD]: LONG64, longObjectField: { nested: LONG64 }, plain: 'short' },
   createdAt: AT, updatedAt: AT, outgoingEdges: [], incomingEdges: [],
   memory: { id: 'mem-A', urn: 'hrn:mem:example.test:mem-a', name: 'Mem A', appId: null },
  };
  const PARENT = {
   graph: {
    id: 'mem-A', urn: 'hrn:mem:example.test:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false,
    schema: { objectTypes: { competitor: { fields: {
     [LONG_FIELD]: { type: 'text', required: true },
     longObjectField: { type: 'text' },
     requiredButMissing: { type: 'text', required: true },
     plain: { type: 'text' },
    } } } },
   },
   graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'fixture-loc', name: 'Fixture Node', nodeType: 'info', tags: [] }],
   isConsumerMode: false, activeOrgId: 'org-1', user: { id: 'u1' },
  };
  const revision = (over = {}) => ({
   id: 'rev-1', revNo: 2, nodeId: 'leaf-pk', loc: 'fixture-loc', name: 'Fixture Node', alias: null,
   description: null, tags: [], revLabel: 'fixture label', changedFields: ['content'], createdAt: AT,
   editedByUser: null, editedByInfo: null, editedByWorker: null, editedByAgent: null, ...over,
  });
  globalThis.__fixtureGql = async doc => {
   if (doc === queries.NODE_BY_ID_QUERY || doc === queries.NODE_QUERY) return { node: NODE };
   if (doc === queries.NODE_REVISIONS_PAGE_QUERY) {
    return { nodeRevisionsPage: { items: [
     revision({ id: 'rev-1', editedByInfo: LONG_INFO }),
     revision({ id: 'rev-2', revNo: 1, editedByUser: { handle: 'fixture-user', urn: 'hrn:user:example.test:fixture:user' }, changedFields: [] }),
    ], total: 2, hasMore: false } };
   }
   if (doc === queries.NODE_EDGE_REMOVALS_QUERY) {
    return { nodeEdgeRemovals: [
     { id: 'rm-1', edgeName: LONG_EDGE_NAME, edgeLoc: LONG_LOC, targetLoc: LONG_TARGET_LOC, targetId: ID32, reason: 'TARGET_HARD_DELETED', removedBy: LONG_ACTOR, createdAt: AT },
     { id: 'rm-2', edgeName: 'relates to', edgeLoc: null, targetLoc: null, targetId: 'j'.repeat(32), reason: 'TARGET_HARD_DELETED', removedBy: null, createdAt: AT },
    ] };
   }
   if (doc === queries.NODE_REVISIONS_PROVENANCE_PAGE_QUERY) return { nodeRevisionsPage: { items: [] } };
   if (doc === queries.NODE_CHILDREN_QUERY) return { findNodes: { hits: [] } };
   if (doc === comments.COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
   if (doc === comments.NODE_COMMENT_SUMMARY_QUERY) {
    return { node: { id: 'leaf-pk', revision: 4, memory: { id: 'mem-A', urn: PARENT.graph.urn }, commentSummary: { openThreads: 0, resolvedThreads: 0, comments: 0, viewerOpenThreadId: null } } };
   }
   if (doc === comments.SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
   // Unknown document: LOUD, per the server-api stub's own contract ("answers
   // NOTHING on its own ... a loud failure, not a silent empty list"). A
   // plausible empty answer here would render an empty panel and never flag
   // that the loader grew a query this map does not cover. Name the operation
   // for a parsed DocumentNode too — String(doc) on one is "[object Object]"
   // (blind review, #2507).
   const opName = doc?.definitions?.[0]?.name?.value
    ?? /(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(String(doc))?.[1]
    ?? '(unnamed)';
   throw new Error(`table-cell-fixture: canned GraphQL map has no answer for ${opName} — add it next to the others`);
  };
  // Nothing in this load may reach the network: every read is the canned map
  // above. A stray real fetch names its URL instead of an opaque ECONNREFUSED.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
   const u = typeof input === 'string' ? input : input?.url ?? String(input);
   // signing-capability's /capabilities probe is DESIGNED to degrade to "every
   // switch off" when the server is unreachable; the stub api's reserved
   // .invalid origin answers it synthetically here so the degradation path is
   // exercised without any network at all.
   // Promise-wrapped (blind review #2507, fold): fetch's contract returns a
   // Promise; the bare Response happened to work under await but breaks any
   // .then/.catch chaining on the result.
   if (u === 'http://fixture.invalid/capabilities') return Promise.resolve(new Response('unavailable', { status: 503 }));
   throw new Error(`table-cell-fixture: unexpected real fetch during the node loader run: ${u}`);
  };
  try {
   const loaded = await loaderMod.load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`),
    parent: async () => PARENT,
   });
   // The streamed promises are awaited INSIDE the guard (blind review, #2507):
   // a streamed branch that fetches must hit the guard's named failure, not
   // the real network after the finally below restores fetch.
   const plain = {}; const streamed = {};
   for (const [k, v] of Object.entries(loaded)) {
    if (v && typeof v.then === 'function') streamed[k] = await v; else plain[k] = v;
   }
   return { parent: PARENT, plain, streamed, tab };
  } finally {
   globalThis.fetch = realFetch;
   // The canned map comes out with the guard: legs run sequentially so it was
   // never re-entrant-unsafe, but a stale map left on globalThis could answer a
   // LATER leg's stray request instead of failing loudly (blind review, #2507).
   delete globalThis.__fixtureGql;
  }
 }
 // From the one routing table (blind review, #2507): a component kind or
 // findings/agent-tasks runs NO page legs — this list once fell back to ALL six
 // page kinds for any non-page kind, dragging the node loader and fetch guard
 // into single-kind runs.
 const pagesKinds = battery.pages;
 for (const kind of pagesKinds) for (const width of widths) for (const dark of [false, true]) {
  const page = await newEmulatedPage(browser, width);
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `${kind}/${width}/${dark ? 'dark' : 'light'}`;
  const legFailuresBefore = failures.length;
  try {
   let nodePayload = null;
   if (NODE_TABS[kind]) {
    nodeLoadedByKind[kind] ??= await loadNodePageData(server, NODE_TABS[kind]);
    nodePayload = nodeLoadedByKind[kind];
   }
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   if (nodePayload) {
    await page.evaluate(async payload => { const { mountLoadedNodePage } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = await mountLoadedNodePage(document.getElementById('fixture'), payload); }, nodePayload);
   } else {
    await page.evaluate(async kind => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = await mountOverflowFixture(document.getElementById('fixture'), kind); }, kind);
   }
   // The agent page opens on its Profile tab; the cells under test are behind
   // the real tab strip, clicked like a reader would. At phone widths TabRow
   // moves its overflow tabs into the real "More ▾" menu — driven through the
   // same buttons a reader gets, never by poking the tab state directly.
   // Locale assumption, pinned (blind review #2507): the accessible-name
   // selections here and the t() fallback strings pinned below hold because
   // t() is the v1 i18n boundary that ALWAYS returns its English defaultText
   // (src/lib/i18n/t.ts) — no locale resolution exists to drift yet. Wiring a
   // real i18n library behind t() makes these locale-sensitive; they will
   // fail loudly here, not silently pass.
   if (kind === 'agent-apps' || kind === 'agent-bundled') {
    const label = kind === 'agent-apps' ? 'Apps' : 'Bundled agents';
    const tab = page.getByRole('tab', { name: label, exact: true }).first();
    const more = page.getByRole('button', { name: /More/ });
    // WAIT for one of the two shapes before choosing (blind review, #2507):
    // isVisible() does not wait, and a strip that has not rendered yet fell
    // through to the More path. Bounded: neither shape rendering rejects here,
    // loudly, instead of clicking at nothing.
    await Promise.race([
     tab.waitFor({ state: 'visible', timeout: 15000 }),
     more.waitFor({ state: 'visible', timeout: 15000 }),
    ]);
    if (await tab.isVisible()) await tab.click();
    else {
     await more.click();
     await page.getByRole('menuitem', { name: label, exact: true }).click();
    }
   }
   await page.locator('tbody td').first().waitFor({ timeout: 15000 });
   if (kind === 'node-history') await page.getByRole('heading', { name: 'Removed edges' }).waitFor({ timeout: 15000 });
   await settlePage(page);
   // Fonts settled once before any measured read (blind review #2507, fold):
   // the geometry reads below are font-metric sensitive, and pixelStrip waits
   // document.fonts.ready for exactly this race — a late webfont swapping in
   // mid-leg changes the measured glyph boxes and queues a false escape.
   await page.evaluate(() => document.fonts.ready);
   // The shared td-level oracle, injected the way the component and wake
   // batteries already do it: readEscapes calls window.__tdGeometry so its
   // definition cannot drift from the one flaggedCell judges by (blind
   // review #2507, fold — this battery had kept a verbatim inline copy).
   await page.evaluate(`window.__tdGeometry = ${tdGeometry.toString()}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}-default.png`, fullPage: true });
   assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), width === 390, `${leg}: actual pointer mode`);
   // net OFF: production containment must be the only thing stopping an escape.
   const net = await page.addStyleTag({ content: 'td { overflow: visible !important; }' });
   await settlePage(page);
   const readEscapes = () => page.locator('tbody td').evaluateAll(cells => cells.map(td => ({ text: td.textContent.slice(0, 50), ...window.__tdGeometry(td) })));
   const clean = await readEscapes();
   const cleanOut = clean.filter(flaggedCell);
   if (cleanOut.length) failures.push(`${leg}: net-off ${JSON.stringify(cleanOut)}`);
   // TITLE pins: the truncate idiom's other half — the full value stays
   // reachable. On main these titles do not exist, so every pin is red there.
   const pinFailures = await page.evaluate(async ({ kind }) => {
    const { PAGE_FIXTURE_VALUES: V } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts');
    const out = [];
    const pin = (label, el, expected) => {
     if (!el) { out.push(`${label}: element not found`); return; }
     const title = el.getAttribute('title');
     if (title !== expected) out.push(`${label}: title ${JSON.stringify(title)} !== ${JSON.stringify(expected)}`);
    };
    const pinStartsWith = (label, el, prefix) => {
     if (!el) { out.push(`${label}: element not found`); return; }
     if (!(el.getAttribute('title') ?? '').startsWith(prefix)) out.push(`${label}: title does not carry ${JSON.stringify(prefix)}`);
    };
    if (kind === 'agents-mine') pin('name link', document.querySelector('a[href="/app/agents/agent-fixture"]'), V.LONG64);
    if (kind === 'memories-mine') pin('name link', document.querySelector('a[href="/app/memories/mem-fixture"]'), V.LONG64);
    if (kind === 'agent-apps') {
     pin('app name link', document.querySelector('a[href="/app/apps/app-fixture"]'), V.LONG64);
     const orgSpan = [...document.querySelectorAll('tbody span')].find(s => (s.getAttribute('title') ?? '').startsWith('FixtureOrg'));
     if (!orgSpan) out.push('org cell: no title carrying the org name');
    }
    if (kind === 'agent-bundled') {
     pin('bundled name link', document.querySelector('a[href="/app/agents/bundled-fixture"]'), V.LONG64);
     pin('bundled description', [...document.querySelectorAll('tbody span')].find(s => s.textContent === V.LONG_DESCRIPTION) ?? null, V.LONG_DESCRIPTION);
     // portal#2512: the Role and Bundled-via spans keep the full value reachable once clamped.
     pin('bundled role', [...document.querySelectorAll('tbody span')].find(s => s.textContent === V.LONG_ROLE) ?? null, V.LONG_ROLE);
     pin('bundled via', [...document.querySelectorAll('tbody span')].find(s => s.textContent === V.LONG_VIA) ?? null, V.LONG_VIA);
    }
    if (kind === 'node-properties') {
     // Structural, not span-order: locate the cell by column index (field=0,
     // value=2) and read ITS titled span, so a new titled inner span elsewhere
     // in the row cannot redirect a pin (blind review, #2507).
     const spanInCell = (row, tdIndex) => row ? (row.children[tdIndex]?.querySelector('span[title]') ?? null) : null;
     const fieldRow = document.querySelector(`[data-testid="typed-property-row"][data-field="${V.LONG_FIELD}"]`);
     pin('field name title', spanInCell(fieldRow, 0), V.LONG_FIELD);
     const objRow = document.querySelector('[data-testid="typed-property-row"][data-field="longObjectField"]');
     pin('object value title', spanInCell(objRow, 2), JSON.stringify({ nested: V.LONG64 }));
     const missingRow = document.querySelector('[data-testid="typed-property-row"][data-field="requiredButMissing"]');
     pinStartsWith('missing-required value title', spanInCell(missingRow, 2), 'missing');
    }
    if (kind === 'node-history') {
     // These select BY the title they assert, so the equality below cannot
     // fail — each is a PRESENCE check (the fix dropped the title, or the
     // element, entirely on main); the node-properties pins above are the
     // structural ones (blind review, #2507).
     pin('edited-by info', document.querySelector(`div[title="${V.LONG_INFO}"]`), V.LONG_INFO);
     pin('edge name', document.querySelector(`span[title="${V.LONG_EDGE_NAME}"]`), V.LONG_EDGE_NAME);
     pin('edge loc', document.querySelector(`code[title="${V.LONG_LOC}"]`), V.LONG_LOC);
     pin('target loc', document.querySelector(`code[title="${V.LONG_TARGET_LOC}"]`), V.LONG_TARGET_LOC);
     pin('target id', document.querySelector(`code[title="${V.ID32}"]`), V.ID32);
     pinStartsWith('removed-by merged title', document.querySelector(`code[title^="${V.LONG_ACTOR}"]`), V.LONG_ACTOR);
    }
    return out;
   }, { kind });
   failures.push(...pinFailures.map(m => `${leg}: ${m}`));
   if (kind === 'node-history') {
    // The ⋯ trigger must sit inside its cell at DEFAULT sizing (the audit's
    // remedy (e): a 28px control + its padding needs a 64px column), and the
    // resize separator must expose that floor.
    const trigger = await page.evaluate(() => {
     const btn = document.querySelector('button[aria-label="Revision actions"]');
     if (!btn) return { missing: true };
     const r = btn.getBoundingClientRect(); const c = btn.closest('td').getBoundingClientRect();
     const table = btn.closest('table');
     const idx = [...btn.closest('td').parentElement.children].indexOf(btn.closest('td'));
     const th = [...table.querySelectorAll('thead th')].find(h => h.cellIndex === idx);
     const minimum = th?.querySelector('[role="separator"]')?.getAttribute('aria-valuemin') ?? null;
     return { missing: false, inside: r.left >= c.left - .5 && r.right <= c.right + .5 && r.top >= c.top - .5 && r.bottom <= c.bottom + .5, column: c.width, minimum: minimum === null ? null : Number(minimum) };
    });
    if (trigger.missing) failures.push(`${leg}: revision actions trigger not found`);
    else {
     if (!trigger.inside) failures.push(`${leg}: ⋯ trigger escapes its ${trigger.column}px actions cell at default sizing`);
     if (trigger.minimum === null || trigger.minimum < 64) failures.push(`${leg}: actions column resize minimum ${trigger.minimum} < 64`);
    }
   }
   // Negative control: a deliberately uncontained span in the target table's
   // first cell must be seen by this same oracle, or a green leg proves nothing.
   const controlTarget = kind === 'node-properties' ? '[data-testid="typed-property-row"] td' : 'tbody td';
   const sawControl = await page.evaluate(async selector => {
    const td = document.querySelector(selector);
    if (!td) return false;
    const n = document.createElement('span'); n.dataset.negativeText = ''; n.style.whiteSpace = 'nowrap'; n.textContent = 'W'.repeat(100); td.append(n);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
   }, controlTarget);
   if (!sawControl) failures.push(`${leg}: negative control had no cell to target`);
   else {
    const dirty = (await readEscapes()).filter(flaggedCell);
    if (!dirty.length) failures.push(`${leg}: negative control not detected by the oracle`);
    await page.evaluate(() => document.querySelector('[data-negative-text]')?.remove());
    const after = (await readEscapes()).filter(flaggedCell);
    if (after.length) failures.push(`${leg}: clean after negative control cleanup ${JSON.stringify(after)}`);
   }
   await net.evaluate(el => el.remove());
   await settlePage(page);
   // A page mount carries real page chrome, unlike the component batteries.
   // TabRow keeps an INVISIBLE aria-hidden w-max measurement strip (its
   // overflow calculator) which pads documentElement.scrollWidth without any
   // reader seeing it — that scaffolding is the tab-strip slice's territory,
   // not this slice's. What must not happen is VISIBLE content wider than the
   // viewport: measured as elements that paint (visibility ≠ hidden, boxes
   // exist) beyond innerWidth, outside the tables' own scrollers.
   //
   // portal#2490 scoping: this battery FAILS only for visible overflow inside
   // a mounted <table> — the surface this slice fixes. Overflow in other page
   // chrome is real (e.g. NodeStorageForm's PropertiesEditor label, whose
   // unbroken 64-char field name has no truncate) but belongs to audit rows
   // this slice did not measure — per the #2490 discipline those stay open
   // and unfixed-blind, so the harness reports them without failing the leg.
   const scan = async insideTables => (await page.evaluate(insideTablesFlag => [...document.querySelectorAll('body *')].filter(el => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || r.right <= innerWidth + 0.5) return false;
    if (!!el.closest('table') !== insideTablesFlag) return false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
     const st = getComputedStyle(a);
     if (/(auto|scroll|hidden|clip)/.test(st.overflowX)) return false;
     if (st.visibility === 'hidden' || !a.getClientRects().length) return false;
    }
    return true;
   }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}«${(el.textContent ?? '').trim().slice(0, 40)}»`), insideTables));
   const inTables = await scan(true);
   if (inTables.length) failures.push(`${leg}: visible document overflow inside a table ${JSON.stringify(inTables)}`);
   const outsideTables = await scan(false);
   if (outsideTables.length) console.log(`${leg}: NOTE out-of-slice visible overflow (open audit row portal#2486, not a failure here): ${JSON.stringify(outsideTables)}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   if (failures.length === legFailuresBefore) console.log(`${leg}: page cells contained, titles pinned, negative control detected`);
   else console.log(`${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`);
  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   // What the page actually rendered when a leg crashed: the first characters
   // of body text, so a missing tab or an empty panel is readable from the log.
   const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '(page gone)');
   console.error(`${leg}: crashed with body text: ${JSON.stringify(bodyText)}`);
   const envProbe = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    maxTouchPoints: navigator.maxTouchPoints,
    metas: [...document.querySelectorAll('meta')].map(m => `${m.name}=${m.content}`).join('|'),
   })).catch(e => `(probe failed: ${e?.message})`);
   console.error(`${leg}: environment ${JSON.stringify(envProbe)}`);
   // The page's OWN errors are part of the crash record (they were dropped
   // before, blind review, #2507), and the stack, not just e.message.
   if (errors.length) failures.push(`${leg}: browser errors before the crash ${JSON.stringify(errors)}`);
   failures.push(`${leg}: leg crashed ${e?.stack ?? e?.message ?? e}`);
  } finally { await page.close(); }
 }

 // ══ portal#2488: the Apps route tables (#1962 slice 2) ════════════════════
 // The REAL route pages are mounted; every cell must keep its content inside
 // its own box with the containment net OFF, at the declared widths and at the
 // minimum width, so no clip can hide an escape. The probe sees inline
 // `truncate` (which clips nothing) as an escape.
 // Kinds come from the one routing table (union, #2507's carry of main's
 // #2488): an apps kind routes to this battery alone; every other kind runs no
 // apps legs. The page is the same emulated one the other batteries use, so
 // pointer/viewport emulation cannot differ between batteries.
 for (const kind of battery.apps) for (const width of widths) for (const dark of [false, true]) {
  const page = await newEmulatedPage(browser, width);
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `${kind}/${width}/${dark ? 'dark' : 'light'}`;
  const legFailuresBefore = failures.length;
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async kind => { const orgs = kind.startsWith('orgs-'); const m = await import(orgs ? '/src/lib/test/fixtures/orgs-cell-harness.ts' : '/src/lib/test/fixtures/apps-cell-fixtures.ts'); window.stopFixture = await (orgs ? m.mountOrgsCellFixture : m.mountAppsCellFixture)(document.getElementById('fixture'), kind); }, kind);
   await page.locator('tbody td').first().waitFor({ timeout: 10000 });
   await settlePage(page);
   // Every column the reader can reveal is revealed: a hidden-by-default column (a Stops Id, a ticker Last tick) is still a cell.
   await page.evaluate(() => window.__fixtureTables.at(-1).toggleAllColumnsVisible(true));
   await settlePage(page);
   // A leg that renders nothing proves nothing: rows are present, every column is revealed, and every column carries content in some row.
   const rendered = await page.evaluate(() => {
    const t = window.__fixtureTables.at(-1);
    // Scoped to the table under test (the last scroller), so a page with several tables cannot satisfy one table's column with another's row.
    const root = [...document.querySelectorAll('[data-testid="data-table-scroller"]')].at(-1) ?? document.createElement('div');
    const heads = [...root.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const rows = [...root.querySelectorAll('tbody tr')];
    const empty = heads.filter((h, i) => h && !rows.some(r => { const td = r.children[i]; return td && (td.textContent.trim() || td.querySelector('svg,img,button,a,input')); }));
    return { rows: rows.length, hidden: t.getAllLeafColumns().filter(c => !c.getIsVisible()).map(c => c.id), empty };
   });
   if (rendered.rows < 3 || rendered.hidden.length || rendered.empty.length) failures.push(`${leg}: the fixture did not render what the probe measures ${JSON.stringify(rendered)}`);
   const net = await page.addStyleTag({ content: 'td { overflow: visible !important; }' });
   // Declared widths first, then a 120px floor (or the column's own larger minSize), the same floor the legacy legs use. This is NOT the
   // DataTable drag floor of 40 (Math.max(40, minSize)): probed at 40 with the containment net off, every table escapes by intrinsic word
   // width alone (a 'Pause' or an 'In effect' pill cannot fit in 40px, and no cell CSS can fix that), so the leg would measure the
   // net-off oracle's own limit, not a defect. Below ~120px the production td clip contains it. Columns declared under 120 (an actions
   // column) are therefore probed wider here than declared; their declared-width pass above is the narrow check.
   for (const sizing of ['declared', 'minimum']) {
    if (sizing === 'minimum') await page.evaluate(() => { const t = window.__fixtureTables.at(-1); t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c => [c.id, Math.max(120, c.columnDef.minSize ?? 40)]))); });
    await settlePage(page);
    const found = await page.evaluate(probeCellEscapes, CELL_ESCAPE_PX);
    if (found.length) failures.push(`${leg}/${sizing}: cell content escapes its cell ${JSON.stringify(found)}`);
    // The table keeps its width inside the page and scrolls internally. (The document's own scrollWidth is not used: the
    // page's TabRow keeps an invisible fixed measuring clone that widens it on main, with or without a table defect.)
    const scrollers = await page.locator('[data-testid="data-table-scroller"]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().right)));
    if (!scrollers.length || scrollers.some(r => r > width + 0.5)) failures.push(`${leg}/${sizing}: the table scroller leaves the page ${JSON.stringify(scrollers)}`);
   }
   // __cellShot, like every CELL_SHOTS site on an emulated page (blind review
   // #2507, fold): a fullPage capture wipes the pinned emulation; this battery's
   // pages come from newEmulatedPage, so the re-pin wrapper applies here too.
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   // The control: the same probe must SEE a deliberate escape in this table, or "no escapes" proves nothing.
   const control = await page.addStyleTag({ content: 'tbody td * { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important; display: inline-block !important; max-width: none !important; } tbody td { white-space: nowrap !important; }' });
   await page.evaluate(() => { document.querySelector('tbody td')?.append(Object.assign(document.createElement('span'), { textContent: 'W'.repeat(120) })); });
   await settlePage(page);
   if ((await page.evaluate(probeCellEscapes, CELL_ESCAPE_PX)).length === 0) failures.push(`${leg}: the escape probe did not see a deliberate escape`);
   // The headline case: an INLINE `truncate` element (overflow:hidden clips nothing on an inline box), real utility classes and no
   // display override. Without it, deleting the probe's inline rule would leave every leg green.
   await control.evaluate(el => el.remove());
   await page.evaluate(() => { document.querySelector('tbody td')?.replaceChildren(Object.assign(document.createElement('span'), { className: 'truncate', textContent: 'W'.repeat(120) })); });
   await settlePage(page);
   if ((await page.evaluate(probeCellEscapes, CELL_ESCAPE_PX)).length === 0) failures.push(`${leg}: the escape probe did not see an inline truncate escape`);
   await control.evaluate(el => el.remove()); await net.evaluate(el => el.remove());
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   console.log(failures.length === legFailuresBefore ? `${leg}: every cell stays inside its box; negative control detected` : `${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`);
  } catch (e) {
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }

 // Shared by the agent-tasks (slice 1) and lib-rows (slice 6) batteries: one oracle, so the two cannot drift.
const cellEscapes = (page, scope) => page.locator(`${scope}tbody td`).evaluateAll((cells, limit) => cells.flatMap(td => {
  const box = td.getBoundingClientRect(), found = [];
  for (const el of td.querySelectorAll('*')) {
   if (el.closest('.sr-only')) continue;
   let clipped = false;
   for (let a = el.parentElement; a && a !== td; a = a.parentElement) { const st = getComputedStyle(a); if (st.overflowX !== 'visible' || st.overflow !== 'visible') { clipped = true; break; } }
   if (clipped) continue;
   let px = 0;
   for (const r of el.getClientRects()) px = Math.max(px, box.left - r.left, r.right - box.right);
   if (px > limit) found.push({ cell: td.textContent.trim().slice(0, 40), el: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`, px: Math.round(px) });
   const st = getComputedStyle(el);
   // portal#2506: a clamp ellipsizes on the y axis and computes text-overflow to `clip`, which the horizontal
   // `ellipsis` test alone never matched — so a compact Urn chip or a PartyLabel name that lost its title
   // went unreported the moment they took the clamp. Both count as ellipsized.
   const ellipsized = (st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) || (st.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1);
   if (ellipsized && !el.closest('[title]')) found.push({ cell: td.textContent.trim().slice(0, 40), el: el.tagName.toLowerCase(), px: 0, note: 'ellipsized with no reachable full value' });
  }
  // Bare text (a cell that renders a string with no element) is judged by its glyph boxes.
  const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
   if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue;
   let clipped = false;
   for (let a = n.parentElement; a && a !== td; a = a.parentElement) { const st = getComputedStyle(a); if (st.overflowX !== 'visible' || st.overflow !== 'visible') { clipped = true; break; } }
   if (clipped) continue;
   const range = document.createRange(); range.selectNodeContents(n);
   let px = 0;
   for (const r of range.getClientRects()) px = Math.max(px, box.left - r.left, r.right - box.right);
   if (px > limit) found.push({ cell: td.textContent.trim().slice(0, 40), el: '#text', px: Math.round(px) });
  }
  return found;
 }), ESCAPE_PX);
 // portal#2487 (#1962 slice 1): the agent-tasks tables. One case per row of the issue, real components and
 // legal synthetic data, default column sizes. A cell passes when no element inside it paints outside its
 // box, and an ellipsized value has its full text reachable (a title). The control appends a nowrap string
 // to the first cell and must see it, so a leg that finds nothing proves the oracle can see.
 // Rows marked `measured` are the issue's browser-check rows: reported, never failed, fixed only where #2486 confirms.
 // Routed through the one table like every other battery (blind review #2507, fold): this was the last
 // hand-written env-kind conditional — batteryFor's agentTasks entry is ['agent-tasks'] exactly for a
 // full run or CELL_KIND=agent-tasks and [] otherwise, so the field is consumed here, not merely pinned
 // by the table test.
 if (battery.agentTasks.length) {
  // Bare pages by design (portal#2487, blind review #2507 fold): this battery pins no
  // emulation and asserts no pointer mode — its oracle is box geometry — so its
  // CELL_SHOTS captures need no __cellShot re-pin (the wipe class is a fullPage
  // capture followed by an emulation read; there is no emulation read here).
  const rowsPage = await browser.newPage();
  let taskRows;
  try {
   await rowsPage.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
   await rowsPage.goto(new URL('/__cell_fixture', origin).href);
   taskRows = await rowsPage.evaluate(async () => (await import('/src/lib/test/fixtures/agent-tasks-cell-harness.ts')).AGENT_TASK_CELL_ROWS);
  } finally { await rowsPage.close(); }
  assert.ok(taskRows.length >= 7, 'the fixture lists every #2487 row');
  for (const width of widths) for (const dark of [false, true]) for (const { listKey, measured, scope } of taskRows) {
   const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
   const errors = await watchErrors(page);
   await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
   const leg = `agent-tasks/${listKey}/${width}/${dark ? 'dark' : 'light'}`;
   try {
    await page.goto(new URL('/__cell_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
     document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
     document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
     document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
    }, { css, dark });
    await page.evaluate(async row => { const { mountAgentTaskCell } = await import('/src/lib/test/fixtures/agent-tasks-cell-harness.ts'); window.stopFixture = mountAgentTaskCell(document.getElementById('fixture'), row); }, listKey);
    await page.locator(`${scope}tbody td`).first().waitFor({ timeout: 10000 });
    // Columns a view hides by default (the roster's Last assigned) still have cells a reader can show.
    await page.evaluate(() => { for (const t of window.__fixtureTables) for (const c of t.getAllLeafColumns()) c.toggleVisibility(true); });
    await settlePage(page);
    const escapes = await cellEscapes(page, scope);
    if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/agent-tasks-${listKey.replaceAll(':', '-')}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    if (measured) console.log(`${leg}: MEASURED (not failed, #2486 decides)`, escapes);
    else {
     if (escapes.length) failures.push(`${leg}: ${JSON.stringify(escapes)}`);
     // Control: a nowrap string in the first cell must be seen escaping, or a clean leg proves nothing.
     await page.locator(`${scope}tbody td`).first().evaluate(td => { const n = document.createElement('span'); n.dataset.negative = ''; n.style.whiteSpace = 'nowrap'; n.textContent = 'W'.repeat(120); td.append(n); });
     if (!(await cellEscapes(page, scope)).some(x => x.el.startsWith('span') && x.px > ESCAPE_PX)) failures.push(`${leg}: the negative control was not detected`);
     await page.locator('[data-negative]').evaluate(el => el.remove());
     console.log(escapes.length ? `${leg}: FAILED` : `${leg}: every cell contains its content; control detected`, escapes);
    }
    // A measured row is reported, never failed: its document overflow is logged by the line above, not queued.
    if (!measured && !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
    await unmountFixture(page);
    assertPatched();
    if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   } catch (e) {
    if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-').replaceAll(':', '-')}.png`, fullPage: true }).catch(() => {});
    throw e;
   } finally { await page.close(); }
  }
 }


 // portal#2492 (#1962 slice 6): the real lib/route tables the issue lists as LIKELY AFFECTED, one case per fixed
 // row, default column sizes, judged by the same escape oracle as agent-tasks. The browser-check rows of the
 // issue are not here: they are fixed only where #2486 confirms them, and none of them is in this PR.
 if (battery.lib.length) {
  const rowsPage = await browser.newPage();
  let libRows;
  try {
   await rowsPage.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
   await rowsPage.goto(new URL('/__cell_fixture', origin).href);
   libRows = await rowsPage.evaluate(async () => (await import('/src/lib/test/fixtures/lib-cell-harness.ts')).LIB_CELL_ROWS);
  } finally { await rowsPage.close(); }
  assert.ok(libRows.length >= 5, 'the fixture lists every fixed #2492 row');
  for (const width of widths) for (const dark of [false, true]) for (const { listKey, prepare, expect, dateColumns, anywhereColumns } of libRows) {
   const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
   const errors = await watchErrors(page);
   await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
   const leg = `lib-rows/${listKey}/${width}/${dark ? 'dark' : 'light'}`;
   try {
    await page.goto(new URL('/__cell_fixture', origin).href);
    await page.evaluate(({ css, dark }) => {
     document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
     document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
     document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
    }, { css, dark });
    await page.evaluate(async row => { const { mountLibCell } = await import('/src/lib/test/fixtures/lib-cell-harness.ts'); window.stopFixture = mountLibCell(document.getElementById('fixture'), row); }, listKey);
    await page.locator('tbody td').first().waitFor({ timeout: 10000 });
    if (prepare) await page.evaluate(async step => { const { prepareLibCell } = await import('/src/lib/test/fixtures/lib-cell-harness.ts'); await prepareLibCell(document.getElementById('fixture'), step); }, prepare);
    // The cell this row exists to measure must be on the page: a prop mismatch would otherwise pass vacuously.
    await page.locator(expect).first().waitFor({ timeout: 10000 });
    await page.evaluate(() => { for (const t of window.__fixtureTables) for (const c of t.getAllLeafColumns()) c.toggleVisibility(true); });
    await settlePage(page);
    const escapes = await cellEscapes(page, '');
    if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/lib-rows-${listKey.replaceAll(':', '-')}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    if (escapes.length) failures.push(`${leg}: ${JSON.stringify(escapes)}`);
    // Control: a nowrap string in the first cell must be seen escaping, or a clean leg proves nothing.
    await page.locator('tbody td').first().evaluate(td => { const n = document.createElement('span'); n.dataset.negative = ''; n.style.whiteSpace = 'nowrap'; n.textContent = 'W'.repeat(120); td.append(n); });
    if (!(await cellEscapes(page, '')).some(x => x.el.startsWith('span') && x.px > ESCAPE_PX)) failures.push(`${leg}: the negative control was not detected`);
    await page.locator('[data-negative]').evaluate(el => el.remove());
    console.log(escapes.length ? `${leg}: FAILED` : `${leg}: every cell contains its content; control detected`, escapes);
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
    // Both checks below need the DOM table that belongs to a table INSTANCE (blind delta 2, #2515): the
    // instance is found by the column ids, the DOM table by its own header texts and column count, never by
    // DOM order. A template editor mounts three tables, so "the first table" is a guess.
    const tableOf = ids => page.evaluate(ids => {
     const t = window.__fixtureTables.find(x => ids.every(id => x.getAllLeafColumns().some(c => c.id === id)));
     if (!t) return null;
     const visible = t.getVisibleLeafColumns();
     const heads = ids.map(id => String(visible.find(c => c.id === id)?.columnDef.header ?? id));
     const table = [...document.querySelectorAll('table')].find(el => {
      const ths = [...el.querySelectorAll('thead th')];
      return ths.length === visible.length && heads.every(h => ths.some(th => th.textContent.includes(h)));
     });
     if (!table) return null;
     // Clear every earlier mark first (blind delta 3, #2515): a mark left on another table would make
     // querySelector('[data-lib-rows-table]') read the wrong table and pass for the wrong reason.
     for (const old of document.querySelectorAll('[data-lib-rows-table]')) old.removeAttribute('data-lib-rows-table');
     table.setAttribute('data-lib-rows-table', '');
     return { ids: visible.map(c => c.id) };
    }, ids);
    // The free-text cells keep `overflow-wrap:anywhere`, judged on the computed style of the element that holds
    // each cell's text (blind delta, #2515): a column id that stopped matching a component's allow-list would drop
    // it silently. overflow-wrap inherits, so the text's own parent is the right element to read: a badge or icon
    // wrapper carrying the class proves nothing about the text. A control (a cell with the class missing) must be reported.
    if (anywhereColumns.length) {
     const owner = await tableOf(anywhereColumns);
     if (!owner) failures.push(`${leg}: no DOM table owns the free-text columns ${JSON.stringify(anywhereColumns)}`);
     else {
      const lost = await page.evaluate(({ ids, cols }) => {
       const lostIn = el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let texts = 0;
        for (let n; (n = walker.nextNode());) {
         if (!n.textContent.trim()) continue;
         texts++;
         if (getComputedStyle(n.parentElement).overflowWrap !== 'anywhere') return 'text not wrapping anywhere';
        }
        return texts === 0 ? 'no text' : null;
       };
       const table = document.querySelector('[data-lib-rows-table]');
       const out = [];
       for (const id of ids) {
        const index = cols.indexOf(id);
        const cells = index < 0 ? [] : [...table.querySelectorAll('tbody tr')].map(r => r.cells[index]).filter(td => td && td.colSpan === 1);
        if (!cells.length) { out.push(`${id}: no cell`); continue; }
        for (const td of cells) { const why = lostIn(td); if (why) out.push(`${id}: ${why}`); }
       }
       // Control: the same text with the wrap left at normal must be reported.
       const probe = document.createElement('div');
       probe.textContent = 'a-long-token-0123456789';
       probe.style.overflowWrap = 'normal';
       document.body.append(probe);
       const control = lostIn(probe);
       probe.remove();
       return { out, control };
      }, { ids: anywhereColumns, cols: owner.ids });
      if (lost.out.length) failures.push(`${leg}: free-text cells lost their wrap-anywhere ${JSON.stringify([...new Set(lost.out)])}`);
      if (!lost.control) failures.push(`${leg}: the wrap-anywhere control (a cell without it) was not reported`);
     }
    }
    // A DATE cell wraps at its spaces and never splits a token (blind review, #2515): with the column
    // narrowed below one token a token may overflow (the reader widens or scrolls) but must not break
    // mid-digit. Guards against passing vacuously: every named date column must render a dated cell, the cells
    // must really be NARROWER than before (judged against their own width before narrowing, not a font-dependent
    // number), and a control (`overflow-wrap:anywhere` on a date, the regression itself) must be reported as a split.
    if (dateColumns.length) {
     const NARROW = 50;
     const owner = await tableOf(dateColumns);
     if (!owner) failures.push(`${leg}: no DOM table owns the date columns ${JSON.stringify(dateColumns)}`);
     else {
      const split = await page.evaluate(({ ids, NARROW, cols }) => {
       const t = window.__fixtureTables.find(x => ids.every(id => x.getAllLeafColumns().some(c => c.id === id)));
       const table = document.querySelector('[data-lib-rows-table]');
       const datedCells = id => {
        const index = cols.indexOf(id);
        return index < 0 ? [] : [...table.querySelectorAll('tbody tr')].map(row => row.cells[index]).filter(td => td && td.colSpan === 1 && /\d/.test(td.textContent));
       };
       // Lines of text inside a cell: the distinct line tops of its characters. The cell's own height cannot say
       // (a row is as tall as its tallest cell), so the text is measured directly.
       const linesIn = td => {
        const tops = new Set();
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n; (n = walker.nextNode());) {
         for (let i = 0; i < n.textContent.length; i++) {
          if (/\s/.test(n.textContent[i])) continue;
          range.setStart(n, i); range.setEnd(n, i + 1);
          const rect = range.getClientRects()[0];
          if (rect) tops.add(Math.round(rect.top / 2));
         }
        }
        return tops.size;
       };
       // Before narrowing, each dated cell's width and line count: the narrowed cell must be narrower AND have
       // WRAPPED onto more lines, because a cell that only shrank proves nothing about whether tokens were split.
       const before = new Map();
       for (const id of ids) for (const td of datedCells(id)) before.set(td, { width: td.getBoundingClientRect().width, lines: linesIn(td) });
       t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c => [c.id, ids.includes(c.id) ? NARROW : (c.columnDef.size ?? 150)])));
       // Split detector: two characters of ONE whitespace-delimited token on different lines.
       const splitsIn = root => {
        const broken = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n; (n = walker.nextNode());) {
         let top = null, token = '';
         const range = document.createRange();
         for (let i = 0; i < n.textContent.length; i++) {
          const ch = n.textContent[i];
          if (/\s/.test(ch)) { top = null; token = ''; continue; }
          range.setStart(n, i); range.setEnd(n, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          if (top !== null && Math.abs(rect.top - top) > 2) { broken.push(`${token}|${ch}`); top = rect.top; token = ch; continue; }
          top = rect.top; token += ch;
         }
        }
        return broken;
       };
       return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const result = { missing: [], wide: [], broken: [], control: [] };
        for (const id of ids) {
         const cells = datedCells(id);
         if (!cells.length) { result.missing.push(id); continue; }
         for (const td of cells) {
          const r = td.getBoundingClientRect(), was = before.get(td);
          if (!was) { result.wide.push(`${id}: a cell appeared after narrowing`); continue; }
          if (!(r.width < was.width - 10)) result.wide.push(`${id}: ${Math.round(r.width)}px, was ${Math.round(was.width)}px`);
          const lines = linesIn(td);
          if (!(lines > was.lines)) result.wide.push(`${id}: did not wrap, ${lines} lines, was ${was.lines}`);
          for (const x of splitsIn(td)) result.broken.push(`${id}: ${x}`);
         }
        }
        // Control: the regression on purpose, in a narrow box of its own.
        const box = document.createElement('div');
        // The content width of a NARROW-px column (cells carry 32px of padding): narrower than any token.
        box.style.cssText = `position:fixed;left:0;top:0;width:${NARROW - 32}px;overflow-wrap:anywhere;font-size:14px`;
        box.textContent = 'Nov 21, 2026, 02:03 PM';
        document.body.append(box);
        result.control = splitsIn(box);
        box.remove();
        resolve(result);
       })));
      }, { ids: dateColumns, NARROW, cols: owner.ids });
      if (split.missing.length) failures.push(`${leg}: date columns that rendered no dated cell ${JSON.stringify(split.missing)}`);
      if (split.wide.length) failures.push(`${leg}: date cells were not narrowed, the split check measured nothing ${JSON.stringify(split.wide.slice(0, 3))}`);
      if (split.control.length === 0) failures.push(`${leg}: the split control (overflow-wrap:anywhere) was not detected`);
      if (split.broken.length) failures.push(`${leg}: a date token splits mid-digit at ${NARROW}px ${JSON.stringify(split.broken.slice(0, 4))}`);
     }
    }
    await unmountFixture(page);
    assertPatched();
    if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   } catch (e) {
    if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-').replaceAll(':', '-')}.png`, fullPage: true }).catch(() => {});
    throw e;
   } finally { await page.close(); }
  }
 }

 // ══ portal#2506: the PartyLabel containment battery ═════════════════════════
 // The shared component's own pin, independent of any one caller: a real DataTable whose
 // Party cell carries the defeating caller wrapper verbatim (TasksRoster's reportsTo span,
 // `inline-flex flex-wrap` with no max-w-full/min-w-0 — see fixtures/PartyLabelDefeatTable.svelte),
 // a ~27-character worker name with its AI-worker badge and compact Urn chip, a person of
 // the same shape, a short worker name, and a long name with no urn. Judged by
 // the same escape oracle as agent-tasks
 // and lib-rows: no element paints outside its td, every ellipsized value keeps its full
 // text in a title (#2506's FIT conditions), and the negative control must be seen. Red on
 // main: the nowrap `truncate` on the name link and the chip's text span carry full-width
 // min-content up the intrinsic chain, so the unbounded wrapper sizes past the cell. Green
 // at the fix: a one-line clamp with [overflow-wrap:anywhere] collapses min-content while
 // keeping the single-line ellipsis.
 //
 // Contained is not yet right (portal#2506, found in the first green shots): a flex
 // row shrinks name and badge by their basis alike, so the "AI worker" pill broke onto
 // two lines in the 200px cell. The fix is a precedence, not a freeze: the name link
 // takes basis-0 grow max-w-max, so it absorbs no shrinkage (the name clamps first)
 // and the badge keeps its one line until the row cannot fit even the badge whole —
 // a `shrink-0` badge was tried and regressed the alarms battery's 28px-text legs,
 // where the whole badge cannot fit and must wrap instead of painting out. Pins:
 // the name gives way before the badge (the badge is on one line beside a truncated
 // name, with a chip below and without), the name is never wider than its own text
 // (the badge sits the row's gap to the right of a short name), and containment
 // holds in a 120px party column — the resize guard's own floor. The battery also
 // proves the shared oracle sees a CLAMP — the self-check below.
 // (Blind F7: the helper's own doc moved down to the helper.)
// Runs in the page: how PartyLabel's name row spends its cell. One reader for
// every pin, so they cannot disagree about which element is which — the name
// link is found by its href, the badge is its next sibling and the pill the
// badge's first child. A Range over the pill's text yields one rectangle per
// line, so `badgeLines` is the pill's line count (blind F7: split out of the
// battery description above).
const readNameRow = link => {
 const lines = el => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()]; };
 const linkBox = link.getBoundingClientRect(), badge = link.nextElementSibling, badgeBox = badge?.getBoundingClientRect();
 return {
  rowWidth: link.parentElement?.getBoundingClientRect().width ?? null,
  linkWidth: linkBox.width,
  textWidth: Math.max(0, ...lines(link).map(rect => rect.width)),
  truncated: link.scrollHeight > link.clientHeight + 1,
  gapToBadge: badgeBox ? badgeBox.left - linkBox.right : null,
  badgeWidth: badgeBox?.width ?? null,
  badgeLines: badge?.firstElementChild ? lines(badge.firstElementChild).length : null,
  hasChip: (link.parentElement?.nextElementSibling ?? null) !== null,
 };
};
 if (battery.partyLabel.length) for (const width of widths) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `party-label/${width}/${dark ? 'dark' : 'light'}`;
  const legFailuresBefore = failures.length;
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async () => { const { mountPartyLabelCell } = await import('/src/lib/test/fixtures/party-label-cell-harness.ts'); window.stopFixture = mountPartyLabelCell(document.getElementById('fixture')); });
   // The cells this battery exists to measure must be on the page: the worker's linked name and its chip.
   // The chip by position (the name row's next sibling in the column), never by the title under test.
   await page.locator('tbody a[href^="/app/workers/"]').first().waitFor({ timeout: 10000 });
   await page.waitForFunction(() => {
    const chipWrapper = document.querySelector('tbody a[href="/app/workers/w-long"]')?.parentElement?.nextElementSibling ?? null;
    return chipWrapper !== null && chipWrapper.querySelector('span') !== null;
   }, undefined, { timeout: 10000 });
   await page.evaluate(() => { for (const t of window.__fixtureTables) for (const c of t.getAllLeafColumns()) c.toggleVisibility(true); });
   await settlePage(page);
   // Fonts settled before the measured read (the same race the pages battery guards).
   await page.evaluate(() => document.fonts.ready);
   const escapes = await cellEscapes(page, '');
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/party-label-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
   if (escapes.length) failures.push(`${leg}: ${JSON.stringify(escapes)}`);
   // TITLE pins — the truncate idiom's other half: the full values stay reachable (#2506 FIT).
   // By position and by text, never by the title under test: a selector that
   // finds the element through its title cannot see the title go (code review, #2506).
   const titles = await page.evaluate(async () => {
    const { LONG_ROW_ID, LONG_WORKER_NAME, LONG_WORKER_URN, LONG_PERSON_NAME } = await import('/src/lib/test/fixtures/party-label-cell-harness.ts');
    const personCell = document.querySelector('tbody tr:nth-child(2) td:nth-child(1)');
    const personName = personCell && [...personCell.querySelectorAll('span')].find(el => el.childElementCount === 0 && el.textContent.trim() === LONG_PERSON_NAME);
    // The chip by position, never by the title under test: the name row's next
    // sibling is the chip wrapper; the descent below it is four steps — the Urn
    // root span, the <a>/<code>/<button> chip (tag not part of the find: it turns
    // on link/pointer state), the chip's box wrapper (portal#2538: padding moved
    // off the clamping span), and the collapsed value span. A DOM shift reports
    // "not found", not a lost title (blind F5).
    const nameRow = document.querySelector(`tbody a[href="/app/workers/${LONG_ROW_ID}"]`)?.parentElement ?? null;
    const chipValue = nameRow?.nextElementSibling?.firstElementChild?.firstElementChild?.firstElementChild?.firstElementChild ?? null;
    return {
      linkTitle: document.querySelector(`tbody a[href="/app/workers/${LONG_ROW_ID}"]`)?.getAttribute('title') ?? null,
      chipFound: chipValue !== null,
      chipTitle: chipValue?.getAttribute('title') ?? null,
      personTitle: personName?.getAttribute('title') ?? null,
      LONG_WORKER_NAME, LONG_WORKER_URN, LONG_PERSON_NAME,
    };
   });
   if (titles.linkTitle !== titles.LONG_WORKER_NAME) failures.push(`${leg}: the name link lost its full value in a title ${JSON.stringify(titles.linkTitle)}`);
   if (!titles.chipFound) failures.push(`${leg}: the chip value span was not found by position — the Urn DOM shifted under the four-step descent (blind F5)`);
   else if (titles.chipTitle !== titles.LONG_WORKER_URN) failures.push(`${leg}: the chip lost its full URN in a title ${JSON.stringify(titles.chipTitle)}`);
   if (titles.personTitle !== titles.LONG_PERSON_NAME) failures.push(`${leg}: the person's clamped name lost its full value in a title ${JSON.stringify(titles.personTitle)}`);
   // THE NAME GIVES WAY BEFORE THE BADGE (portal#2506). The long worker's row is the one that lacks room.
   // A row's link is found by its href, never by the title under test.
   const linkOf = id => page.locator(`tbody a[href="/app/workers/${id}"]`);
   const longRow = await linkOf('w-long').evaluate(readNameRow);
   if (!longRow.truncated) failures.push(`${leg}: the long name is not truncated at ${width}px, so this leg proves nothing about what gives way`);
   if (longRow.badgeLines !== 1) failures.push(`${leg}: the AI-worker badge is on ${longRow.badgeLines} lines beside a truncated name; the name gives way first`);
   // THE CHIP STAYS READABLE (portal#2538, QA F1): containment alone did not
   // make the chip readable — py-0.5 on the clamping span showed the wrapped
   // second line's top in the padding band (live QA run: roster Worker cell,
   // Composition, task page), and a squeezeed cell could read "e2e-…". The
   // peek is fixed structurally (padding off the clip span, box split), and
   // this is the pin for the other half: the value span's FIRST line box
   // fills the span — the ellipsis lands at the END of whatever width the
   // caller gives the chip, never after the first hyphen. Line boxes UNDER
   // the first are the clamp working (they clip at the span's content edge,
   // which carries no padding), so only the first is asserted. How WIDE a
   // cell renders the chip is caller column sizing: a min-width floor here
   // was measured to trade directly against containment (10ch ⇒ 2px escapes
   // at 390, logs/qa-f1-floor-*.log) and is deliberately not pinned.
   const chipLines = await linkOf('w-long').evaluate(link => {
    const value = link.parentElement?.nextElementSibling?.firstElementChild?.firstElementChild?.firstElementChild?.firstElementChild ?? null;
    if (!value) return { found: false };
    const range = document.createRange(); range.selectNodeContents(value);
    const rects = [...range.getClientRects()];
    // The chain of widths from the cell down, for the failure message: where
    // the available width collapses is not guessable from a line count.
    const chain = [];
    for (let el = value; el && el !== link.closest('td'); el = el.parentElement) chain.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}:${Math.round(el.getBoundingClientRect().width)}`);
    // One glyph of the value's own font: a break-anywhere line can leave less
    // than one glyph unfilled and still be full, so that is the tolerance (it
    // replaces a bare 8px). Padding on the clamping span is the QA F1 band:
    // a clamped element clips at its PADDING box, so any vertical padding here
    // re-opens it; the box and its padding live on the parent wrapper.
    // The first character comes from the first NON-EMPTY text node (a comment
    // anchor or an empty node ahead of it must not make Range throw inside this
    // evaluate and abort the leg before the glyph guard speaks).
    const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode && !textNode.data.length) textNode = walker.nextNode();
    let glyphW = 0;
    if (textNode) { const one = document.createRange(); one.setStart(textNode, 0); one.setEnd(textNode, 1); glyphW = one.getBoundingClientRect().width; }
    const cs = getComputedStyle(value);
    const wcs = getComputedStyle(value.parentElement);
    return { found: true, firstLineW: rects[0]?.width ?? 0, spanW: value.getBoundingClientRect().width, glyphW, lines: rects.length, padY: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), wrapperPadTop: parseFloat(wcs.paddingTop), wrapperPadBottom: parseFloat(wcs.paddingBottom), chain };
   });
   if (!chipLines.found) failures.push(`${leg}: the chip value span vanished between the title check and the line check (QA F1 pin)`);
   else if (!(chipLines.lines > 1)) failures.push(`${leg}: the chip value fits on ${chipLines.lines} line box, so the first-line pin has nothing to say (the fixture must force a wrap; a vacuous pass is a failure)`);
   else if (!(chipLines.glyphW > 0)) failures.push(`${leg}: the chip value has no measurable glyph, so the line pin cannot say anything (a vacuous pass is a failure)`);
   else if (!Number.isFinite(chipLines.padY) || chipLines.padY !== 0) failures.push(`${leg}: the clamping span carries ${chipLines.padY}px of vertical padding — a clamp clips at its padding box, so a wrapped second line shows in that band (QA F1); the padding belongs on the wrapper`);
   else if (!(chipLines.wrapperPadTop > 0 && chipLines.wrapperPadBottom > 0)) failures.push(`${leg}: the chip's wrapper lost its vertical padding (top ${chipLines.wrapperPadTop}px, bottom ${chipLines.wrapperPadBottom}px) — the chip box is gone, not moved`);
   else if (chipLines.firstLineW < chipLines.spanW - chipLines.glyphW) failures.push(`${leg}: the chip's first line is ${Math.round(chipLines.firstLineW)}px of a ${Math.round(chipLines.spanW)}px span — it breaks early (the "e2e-…" shape, QA F1) instead of ellipsizing at the end; widths down the chain: ${chipLines.chain.join(' > ')}`);
   // …and the name is never wider than its own text: beside a short name the chip is
   // the wide item and the row is as wide as the chip, and the badge still sits the
   // row's gap (6px) to the right of the NAME — not at the far end of the row.
   const shortRow = await linkOf('w-short').evaluate(readNameRow);
   if (shortRow.truncated) failures.push(`${leg}: the short name truncates, so its link's own width cannot be read`);
   if (Math.abs(shortRow.linkWidth - shortRow.textWidth) > 1) failures.push(`${leg}: the name link is ${shortRow.linkWidth}px wide for ${shortRow.textWidth}px of text`);
   if (shortRow.gapToBadge === null || Math.abs(shortRow.gapToBadge - 6) > 1) failures.push(`${leg}: the badge sits ${shortRow.gapToBadge}px right of the name's text, not the row's 6px gap`);
   // THE NO-CHIP ROW (portal#2506). `urn` is nullable by contract: a worker with
   // no URN renders the name row on its own — never an empty chip (render-absent,
   // the Urn review rule) — and there too the name gives way before the badge,
   // so the fix does not lean on the chip squeezing the column.
   const noChipRow = await linkOf('w-nochip').evaluate(readNameRow);
   if (noChipRow.hasChip) failures.push(`${leg}: a worker with a null urn rendered a chip`);
   if (!noChipRow.truncated) failures.push(`${leg}: the no-chip row's long name is not truncated, so this leg proves nothing about what gives way`);
   if (noChipRow.badgeLines !== 1) failures.push(`${leg}: the no-chip row's badge is on ${noChipRow.badgeLines} lines beside a truncated name`);
   // Control: a nowrap string in the first cell must be seen escaping, or a clean leg proves nothing.
   await page.locator('tbody td').first().evaluate(td => { const n = document.createElement('span'); n.dataset.negative = ''; n.style.whiteSpace = 'nowrap'; n.textContent = 'W'.repeat(120); td.append(n); });
   if (!(await cellEscapes(page, '')).some(x => x.el.startsWith('span') && x.px > ESCAPE_PX)) failures.push(`${leg}: the negative control was not detected`);
   await page.locator('[data-negative]').evaluate(el => el.remove());
   // THE ORACLE SEES A CLAMP (portal#2506). A clamp ellipsizes on the y axis and
   // computes text-overflow to `clip`, which the oracle's horizontal `ellipsis`
   // test never matched — so with the clamp alone, a compact Urn chip or a
   // PartyLabel name that lost its title went unreported in every battery. Strip
   // the link's title: the oracle has to report it.
   const nameLink = linkOf('w-long');
   await nameLink.evaluate(el => el.removeAttribute('title'));
   // Blind F4: the note alone can be satisfied by any ellipsized element on the
   // page — the stripped LINK must be the one the oracle reports.
   if (!(await cellEscapes(page, '')).some(x => x.el === 'a' && x.note === 'ellipsized with no reachable full value')) failures.push(`${leg}: a clamped, truncated name link without a title was not reported by the escape oracle`);
   await nameLink.evaluate((el, name) => el.setAttribute('title', name), titles.LONG_WORKER_NAME);
   // THE NARROW COLUMN (portal#2506): the Party column at 120px — the narrowest
   // a user can make it (the resize guard's own floor) — still contains the
   // stack with ~88px of content: the name clamps to a ~22px sliver, the badge
   // keeps its whole one line (~60px + gap), the chip clamps itself. The badge's
   // give-way floor is ~66px of row content (party column ~100px); below it the
   // badge wraps rather than painting out. Not probed at 390: there the chip's
   // two 44px coarse-pointer touch targets (#1604) need ~115px on their own, so
   // no sub-115px party cell can contain a chip row regardless of this fix. The
   // regime where the whole badge CANNOT fit (28px text zoom in a 120px column)
   // and the badge must wrap instead of painting out is pinned by the alarms
   // battery's text-zoom legs. The success line says whether THIS leg ran the
   // probe — the gate and the wording share one table, so a leg that skipped it
   // never reports the claim (the #2506 delta review).
   if (width === PARTY_NARROW_PROBE_WIDTH) {
    await page.evaluate(() => { window.__fixtureTables.at(-1).setColumnSizing({ party: 120 }); });
    await settlePage(page);
    const narrowEscapes = await cellEscapes(page, '');
    if (narrowEscapes.length) failures.push(`${leg}/party-120px: ${JSON.stringify(narrowEscapes)}`);
    const longRowNarrow = await linkOf('w-long').evaluate(readNameRow);
    if (!longRowNarrow.truncated) failures.push(`${leg}/party-120px: the long name is not truncated in the 120px column`);
    if (longRowNarrow.badgeLines !== 1) failures.push(`${leg}/party-120px: the badge wrapped in the 120px column (row ${Math.round(longRowNarrow.rowWidth)}px, link ${Math.round(longRowNarrow.linkWidth)}px, badge ${Math.round(longRowNarrow.badgeWidth)}px on ${longRowNarrow.badgeLines} lines) — 120px fits the whole badge, so the badge must not give way there`);
    const noChipNarrow = await linkOf('w-nochip').evaluate(readNameRow);
    if (!noChipNarrow.truncated || noChipNarrow.badgeLines !== 1) failures.push(`${leg}/party-120px: the no-chip row's name does not give way before the badge (truncated ${noChipNarrow.truncated}, badge on ${noChipNarrow.badgeLines} lines)`);
   }
   if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   // Blind F3: derive the success line from the failures queue (the file's own
   // newer pattern), not from `escapes` — a title, badge, no-chip or overflow
   // failure used to leave the leg still claiming "titles carry the full values".
   console.log(failures.length === legFailuresBefore ? `${leg}: the defeating wrapper contains name and chip, titles carry the full values; the name gives way before the badge (${Math.round(longRow.linkWidth)}px link, badge on ${longRow.badgeLines} line); ${partyNarrowProbeNote(width)}; the oracle sees a clamp; control detected` : `${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`);
  } catch (e) {
   // Blind F8: a rethrow here discarded every queued finding from earlier legs —
   // the masking this battery exists to prevent. Queue the crash, keep the
   // remaining legs; the final assert reports the lot.
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-party-label-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true }).catch(() => {});
   failures.push(`${leg}: crashed after ${failures.length - legFailuresBefore} check(s) queued: ${e?.message ?? String(e)}`);
  } finally { await page.close(); }
 }

 assert.deepEqual(failures, []);
} finally { await browser?.close(); await server.close(); }
