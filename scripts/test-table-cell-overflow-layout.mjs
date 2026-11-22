// #1942: real components/CSS, synthetic data only. No production or backend.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { parseHarnessEnv, injectionEcho, APPS_KINDS } from './lib/cell-harness-env.mjs';
import { sameMembers, pointerVerdict } from './lib/cell-harness-checks.mjs';
import { messages } from './lib/cell-harness-messages.mjs';
import { probeCellEscapes, ESCAPE_PX as CELL_ESCAPE_PX } from './lib/cell-escape-probe.mjs';
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
// portal#2488: the real Apps route pages import $app/forms, $app/environment and the public env; same stubs as the client test lane.
const stub = name => new URL(`../src/lib/test/stubs/${name}.ts`, import.meta.url).pathname;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, resolve: { alias: { '$app/forms': stub('app-forms'), '$app/environment': stub('app-environment'), '$env/dynamic/public': stub('env-dynamic-public') } }, plugins: [{
 name: 'table-cell-fixture', enforce: 'pre', transform(code, id) {
  if (/\/(AppRunsTable|TasksAlarms|AiServiceConfigManager)\.svelte$/.test(id)) {
   // Every one of the three imports $app/navigation; only TasksAlarms also imports $app/stores.
   const navigated = patchSource(code, id, "from '$app/navigation'", "from '$lib/test/stubs/app-navigation'");
   const patched = patchSource(navigated, id, "from '$app/stores'", "from '$lib/test/stubs/app-stores'", id.endsWith('/TasksAlarms.svelte'));
   // Any other $app/ import (a type import, a new store) would run unstubbed.
   if (/from ['"]\$app\//.test(patched)) patchFailure(`table-cell-fixture: an $app/ import is left unpatched in ${id}`);
   return patched;
  }
  // Expose only the fixture's actual table objects, no production test API.
  if (id.endsWith('/createSvelteTable.svelte.ts')) return patchSource(code, id, 'return createTable(withFeatures(options));', 'const fixtureTable = createTable(withFeatures(options)); globalThis.__fixtureTables ??= []; globalThis.__fixtureTables.push(fixtureTable); return fixtureTable;');
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
 if (process.env.CELL_SHOTS) await mkdir(process.env.CELL_SHOTS, { recursive: true });
 const cellWidth = env.cellWidth;
 const widths = cellWidth !== null ? [cellWidth] : [390, 1280];
 for (const width of widths) for (const dark of [false, true]) for (const kind of (env.cellKind ? [env.cellKind] : ['alarms', 'runs', 'config']).filter(k => !['findings', 'agent-tasks', ...APPS_KINDS].includes(k))) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
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
   await page.evaluate(async kind => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = mountOverflowFixture(document.getElementById('fixture'), kind); }, kind);
   await page.locator('tbody td').first().waitFor();
   if (kind === 'alarms') {
    const action = await page.locator('form').first().getAttribute('action');
    const target = new URL(action, page.url());
    assert.equal(target.searchParams.get('alarmBefore'), 'fixture-page-boundary', 'Alarms fixture supplies the current route slice to the real native form');
    assert.equal(target.searchParams.getAll('/acknowledgeAlarm').length, 1, 'one intended named action');
   }
   if (process.env.CELL_SHOTS) await page.screenshot({path:`${process.env.CELL_SHOTS}/${kind}-${width}-${dark?'dark':'light'}-default.png`,fullPage:true});
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
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/${kind}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   assert.deepEqual(errors, [], 'no browser errors');
   console.log(`${kind}/${width}/${dark ? 'dark' : 'light'}: completed 8 sizing/text legs + native controls/menu/minimum`,{paint,narrowPaint});

  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-${kind}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }
 // portal#2118 item 5: the findings table has no interactive column, so it gets its own geometry pass.
 // Severity (six revealed markers, and an 80-character plain label) and text stay inside their cells
 // (#2115 QA F1, #2119). The control strips severity's wrap and must see the overflow.
 if (!env.cellKind || env.cellKind === 'findings') for (const width of widths) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
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
   await page.evaluate(async () => { const { mountOverflowFixture } = await import('/src/lib/test/fixtures/table-cell-overflow-harness.ts'); window.stopFixture = mountOverflowFixture(document.getElementById('fixture'), 'findings'); });
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
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   await unmountFixture(page);
   assertPatched();
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   // The success line only prints for a leg that queued nothing.
   if (failures.length === legFailuresBefore) console.log(`${leg}: severity and text inside their cells (both axes); negative control detected`, clean);
   else console.log(`${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`, clean);
  } catch (e) {
   if (patchFailures.length) console.error(`patch failures: ${patchFailures.join('; ')}`);
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }
 // portal#2488: the Apps route tables (#1962 slice 2). The REAL route pages are mounted; every cell must keep
 // its content inside its own box with the containment net OFF, at the declared widths and at the minimum
 // width, so no clip can hide an escape. The probe sees inline `truncate` (which clips nothing) as an escape.
 if (!env.cellKind || APPS_KINDS.includes(env.cellKind)) for (const kind of (env.cellKind ? [env.cellKind] : APPS_KINDS)) for (const width of widths) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
  const errors = await watchErrors(page);
  await page.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
  const leg = `${kind}/${width}/${dark ? 'dark' : 'light'}`;
  try {
   await page.goto(new URL('/__cell_fixture', origin).href);
   await page.evaluate(({ css, dark }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
    document.body.innerHTML = '<main id="fixture" class="min-w-0 p-4"></main>';
   }, { css, dark });
   await page.evaluate(async kind => { const { mountAppsCellFixture } = await import('/src/lib/test/fixtures/apps-cell-fixtures.ts'); window.stopFixture = await mountAppsCellFixture(document.getElementById('fixture'), kind); }, kind);
   await page.locator('tbody td').first().waitFor({ timeout: 10000 });
   await settlePage(page);
   const legFailuresBefore = failures.length;
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
   // Declared widths first, then the table's own minimum (the declared size is a default the reader can drag below).
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
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
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
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/FAILED-${leg.replaceAll('/', '-')}.png`, fullPage: true }).catch(() => {});
   throw e;
  } finally { await page.close(); }
 }

 // portal#2487 (#1962 slice 1): the agent-tasks tables. One case per row of the issue, real components and
 // legal synthetic data, default column sizes. A cell passes when no element inside it paints outside its
 // box, and an ellipsized value has its full text reachable (a title). The control appends a nowrap string
 // to the first cell and must see it, so a leg that finds nothing proves the oracle can see.
 // Rows marked `measured` are the issue's browser-check rows: reported, never failed, fixed only where #2486 confirms.
 if (!env.cellKind || env.cellKind === 'agent-tasks') {
  const rowsPage = await browser.newPage();
  let taskRows;
  try {
   await rowsPage.route('**/__cell_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cell fixture</title>' }));
   await rowsPage.goto(new URL('/__cell_fixture', origin).href);
   taskRows = await rowsPage.evaluate(async () => (await import('/src/lib/test/fixtures/agent-tasks-cell-harness.ts')).AGENT_TASK_CELL_ROWS);
  } finally { await rowsPage.close(); }
  assert.ok(taskRows.length >= 7, 'the fixture lists every #2487 row');
  const taskCellEscapes = (page, scope) => page.locator(`${scope}tbody td`).evaluateAll((cells, limit) => cells.flatMap(td => {
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
    if (st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.closest('[title]')) found.push({ cell: td.textContent.trim().slice(0, 40), el: el.tagName.toLowerCase(), px: 0, note: 'ellipsized with no reachable full value' });
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
    const escapes = await taskCellEscapes(page, scope);
    if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/agent-tasks-${listKey.replaceAll(':', '-')}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    if (measured) console.log(`${leg}: MEASURED (not failed, #2486 decides)`, escapes);
    else {
     if (escapes.length) failures.push(`${leg}: ${JSON.stringify(escapes)}`);
     // Control: a nowrap string in the first cell must be seen escaping, or a clean leg proves nothing.
     await page.locator(`${scope}tbody td`).first().evaluate(td => { const n = document.createElement('span'); n.dataset.negative = ''; n.style.whiteSpace = 'nowrap'; n.textContent = 'W'.repeat(120); td.append(n); });
     if (!(await taskCellEscapes(page, scope)).some(x => x.el.startsWith('span') && x.px > ESCAPE_PX)) failures.push(`${leg}: the negative control was not detected`);
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
 assert.deepEqual(failures, []);
} finally { await browser?.close(); await server.close(); }
