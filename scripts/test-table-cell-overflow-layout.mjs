// #1942: real components/CSS, synthetic data only. No production or backend.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// portal#2490: the six route-page kinds. Everything else is a component kind.
const PAGE_KINDS = ['agents-mine', 'memories-mine', 'agent-apps', 'agent-bundled', 'node-properties', 'node-history'];
import { parseHarnessEnv, injectionEcho } from './lib/cell-harness-env.mjs';
import { sameMembers, pointerVerdict } from './lib/cell-harness-checks.mjs';
import { messages } from './lib/cell-harness-messages.mjs';
// portal#2129: every env knob is validated, and any active injection announced, before the dev server or a browser starts.
const env = parseHarnessEnv(process.env);
for (const line of injectionEcho(env)) console.log(line);
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
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
 name: 'table-cell-fixture', enforce: 'pre',
 transform(code, id) {
  // portal#2490: rewrite the no-browser specifiers everywhere under src/ (the
  // fixture's own page mounts, their transitive imports, and the node loader's
  // graph — the latter via the dev server's SSR environment). This subsumes the
  // per-component $app patches this plugin used to make (same stub files);
  // an $app/$env import the map does not know still fails loudly below.
  const srcRoot = path.resolve(__dirname, '../src');
  if (id.startsWith(srcRoot) && /\.(ts|svelte|js|mjs)$/.test(id) && !id.includes('/.svelte-kit/') && !id.includes('/stubs/')) {
   let patched = code;
   for (const [from, to] of Object.entries(STUB_SPECIFIERS)) {
    patched = patched.replaceAll(`'${from}'`, `'$lib/test/stubs/${to}'`).replaceAll(`"${from}"`, `"$lib/test/stubs/${to}"`);
   }
   // A $app/ or $env/ import the map does not know would run unstubbed.
   if (/from ['"]\$app\//.test(patched) || /from ['"]\$env\//.test(patched)) patchFailure(`table-cell-fixture: an unpatched $app/$env import is left in ${id}`);
   code = patched;
  }
  if (/\/(AppRunsTable|TasksAlarms|AiServiceConfigManager)\.svelte$/.test(id)) {
   // The generic rewrite above already carries the three components' $app
   // imports to the stubs; this branch stays as the loud guard that they DID
   // resolve through this plugin (a stale path here means a silently
   // unpatched component).
   if (/from ['"]\$app\//.test(code)) patchFailure(`table-cell-fixture: an $app/ import is left unpatched in ${id}`);
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
const newEmulatedPage = async (browser, width) => {
 const coarse = width === 390;
 const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: coarse });
 const cdp = await page.context().newCDPSession(page);
 const pin = async () => {
  if (coarse) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: coarse ? 'coarse' : 'fine' }] });
 };
 await pin();
 page.__cellPin = pin;
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
let browser;
const failures = [];
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('/src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 // portal#2490: warm the CLIENT dep optimizer with the six page graphs before
 // any timed leg. The pages' dynamic imports are only discovered at request
 // time (the fixture's stub rewrite runs in the transform pipeline, which the
 // dep scanner does not see), and vite's first discovery of a new dependency
 // re-optimizes and force-reloads the page — destroying the mount evaluate's
 // execution context mid-import. Seen exactly once per cold cache, on the
 // first page leg. Warming on a throwaway page makes that reload happen here.
 {
  const warm = await newEmulatedPage(browser, 1280);
  await warm.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>warm</title>' }));
  await warm.goto(new URL('/__cell_fixture', origin).href);
  await warm.evaluate(async () => { await Promise.allSettled([
   import('/src/routes/app/agents/+page.svelte'),
   import('/src/routes/app/memories/+page.svelte'),
   import('/src/routes/app/agents/[id]/+page.svelte'),
   import('/src/routes/app/agents/[id]/page-fixture'),
   import('/src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte'),
   import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'),
  ]); }).catch(() => {});
  // A mid-import optimizer reload can also kill THIS evaluate; give the
  // browser the moment vite needs to finish and reload, then close.
  await warm.waitForLoadState('load').catch(() => {});
  await warm.close();
 }
 if (process.env.CELL_SHOTS) await mkdir(process.env.CELL_SHOTS, { recursive: true });
 const cellWidth = env.cellWidth;
 const widths = cellWidth !== null ? [cellWidth] : [390, 1280];
 // portal#2490: a page kind routes to the pages battery below, never here.
 // The findings fixture is a battery of its own below (it has the injection
// knobs and a different oracle); keep it out of THIS loop the way the
// pre-#2490 script's .filter(k => k !== 'findings') did — its first column
// is not a pixelStrip candidate.
const componentKinds = (env.cellKind === null || PAGE_KINDS.includes(env.cellKind) ? (env.cellKind === null ? ['alarms', 'runs', 'config'] : []) : [env.cellKind]).filter(k => k !== 'findings');
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
     // The 120px and wider oracle is strict: no clipping may mask a repair.
     const geometry = await page.locator('tbody td').evaluateAll(cells => cells.map(td => {
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
      return { text: td.textContent.slice(0, 50), width: rect.width, scroll: td.scrollWidth, client: td.clientWidth, badGlyphs };
     }));
     const overflow = geometry.filter(x => x.width >= 119 && (x.scroll > x.client + 1 || x.badGlyphs.length));
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
 if (!env.cellKind || env.cellKind === 'findings') for (const width of widths) for (const dark of [false, true]) {
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
 async function loadNodePageData(server, tab) {
  const loaderMod = await server.ssrLoadModule('/src/routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts');
  const queries = await server.ssrLoadModule('/src/lib/server/queries.ts');
  const comments = await server.ssrLoadModule('/src/lib/server/comments.ts');
  // Synthetic content — the SAME literals the fixture's PAGE_FIXTURE_VALUES
  // pins compare against. Keep the two lists in step; a drift fails the pins.
  const LONG64 = 'LongFixtureNameWithFortyUnbrokenCharacters' + 'W'.repeat(22);
  const LONG_FIELD = 'fixtureField' + 'F'.repeat(52);
  const LONG_LOC = 'fixture:edge:' + 'l'.repeat(50);
  const LONG_TARGET_LOC = 'fixture:target:' + 't'.repeat(49);
  const ID32 = 'i'.repeat(32);
  const LONG_ACTOR = 'actor-example.test:fixture-account-with-long-unbroken-id';
  const LONG_INFO = 'worker-example.test:fixture:identity-with-long-unbroken-suffix';
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
     { id: 'rm-1', edgeName: 'depends on', edgeLoc: LONG_LOC, targetLoc: LONG_TARGET_LOC, targetId: ID32, reason: 'TARGET_HARD_DELETED', removedBy: LONG_ACTOR, createdAt: AT },
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
   return { memories: { items: [], total: 0 }, node: null, nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
  };
  const loaded = await (async () => {
   // Nothing in this load may reach the network: every read is the canned map
   // above. A stray real fetch names its URL instead of an opaque ECONNREFUSED.
   const realFetch = globalThis.fetch;
   globalThis.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input?.url ?? String(input);
    // signing-capability's /capabilities probe is DESIGNED to degrade to "every
    // switch off" when the server is unreachable; the stub api's reserved
    // .invalid origin answers it synthetically here so the degradation path is
    // exercised without any network at all.
    if (u === 'http://fixture.invalid/capabilities') return new Response('unavailable', { status: 503 });
    throw new Error(`table-cell-fixture: unexpected real fetch during the node loader run: ${u}`);
   };
   try {
    return await loaderMod.load({
     params: { id: 'mem-A', nodeId: 'leaf-pk' },
     locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
     url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`),
     parent: async () => PARENT,
    });
   } finally { globalThis.fetch = realFetch; }
  })();
  const plain = {}; const streamed = {};
  for (const [k, v] of Object.entries(loaded)) {
   if (v && typeof v.then === 'function') streamed[k] = await v; else plain[k] = v;
  }
  return { parent: PARENT, plain, streamed, tab };
 }
 const pagesKinds = env.cellKind === null || PAGE_KINDS.includes(env.cellKind) ? (env.cellKind === null ? PAGE_KINDS : [env.cellKind]) : [];
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
   if (kind === 'agent-apps' || kind === 'agent-bundled') {
    const label = kind === 'agent-apps' ? 'Apps' : 'Bundled agents';
    const tab = page.getByRole('tab', { name: label, exact: true }).first();
    if (await tab.isVisible()) await tab.click();
    else {
     await page.getByRole('button', { name: /More/ }).click();
     await page.getByRole('menuitem', { name: label, exact: true }).click();
    }
   }
   await page.locator('tbody td').first().waitFor({ timeout: 15000 });
   if (kind === 'node-history') await page.getByRole('heading', { name: 'Removed edges' }).waitFor({ timeout: 15000 });
   await settlePage(page);
   if (process.env.CELL_SHOTS) await page.__cellShot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}-default.png`, fullPage: true });
   assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), width === 390, `${leg}: actual pointer mode`);
   // net OFF: production containment must be the only thing stopping a escape.
   const net = await page.addStyleTag({ content: 'td { overflow: visible !important; }' });
   await settlePage(page);
   const readEscapes = () => page.locator('tbody td').evaluateAll(cells => cells.map(td => {
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
    return { text: td.textContent.slice(0, 50), width: rect.width, scroll: td.scrollWidth, client: td.clientWidth, badGlyphs };
   }));
   const clean = await readEscapes();
   const cleanOut = clean.filter(x => x.width >= 119 && (x.scroll > x.client + 1 || x.badGlyphs.length));
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
    }
    if (kind === 'node-properties') {
     const spans = row => row ? [...row.querySelectorAll('td span[title]')] : [];
     const fieldRow = document.querySelector(`[data-testid="typed-property-row"][data-field="${V.LONG_FIELD}"]`);
     pin('field name title', spans(fieldRow)[0] ?? null, V.LONG_FIELD);
     const objRow = document.querySelector('[data-testid="typed-property-row"][data-field="longObjectField"]');
     pin('object value title', spans(objRow).at(-1) ?? null, JSON.stringify({ nested: V.LONG64 }));
     const missingRow = document.querySelector('[data-testid="typed-property-row"][data-field="requiredButMissing"]');
     pinStartsWith('missing-required value title', spans(missingRow).at(-1) ?? null, 'missing');
    }
    if (kind === 'node-history') {
     pin('edited-by info', document.querySelector(`div[title="${V.LONG_INFO}"]`), V.LONG_INFO);
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
    const dirty = (await readEscapes()).filter(x => x.width >= 119 && (x.scroll > x.client + 1 || x.badGlyphs.length));
    if (!dirty.length) failures.push(`${leg}: negative control not detected by the oracle`);
    await page.evaluate(() => document.querySelector('[data-negative-text]')?.remove());
    const after = (await readEscapes()).filter(x => x.width >= 119 && (x.scroll > x.client + 1 || x.badGlyphs.length));
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
   if (outsideTables.length) console.log(`${leg}: NOTE out-of-slice visible overflow (open audit row, not a failure here): ${JSON.stringify(outsideTables)}`);
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
   failures.push(`${leg}: leg crashed ${e?.message ?? e}`);
  } finally { await page.close(); }
 }
 assert.deepEqual(failures, []);
} finally { await browser?.close(); await server.close(); }
