// #1942: real components/CSS, synthetic data only. No production or backend.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
 name: 'table-cell-fixture', enforce: 'pre', transform(code, id) {
  if (/\/(AppRunsTable|TasksAlarms|AiServiceConfigManager)\.svelte$/.test(id)) return code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'").replace("from '$app/stores'", "from '$lib/test/stubs/app-stores'");
  // Expose only the fixture's actual table objects, no production test API.
  if (id.endsWith('/createSvelteTable.svelte.ts')) return code.replace('return createTable(withFeatures(options));', 'const fixtureTable = createTable(withFeatures(options)); globalThis.__fixtureTables ??= []; globalThis.__fixtureTables.push(fixtureTable); return fixtureTable;');
 }
}] });
// Pixel-strip oracle compares the SAME neighboring strip with source text
// visible/hidden; backgrounds, borders and neighboring content are identical.
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
let browser;
const failures = [];
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('/src/app.css?direct', origin))).text();
 browser = await chromium.launch({ headless: true });
 if (process.env.CELL_SHOTS) await mkdir(process.env.CELL_SHOTS, { recursive: true });
 const cellWidth = process.env.CELL_WIDTH === undefined ? null : Number(process.env.CELL_WIDTH);
 if (cellWidth !== null && !(Number.isFinite(cellWidth) && cellWidth > 0)) throw new Error(`CELL_WIDTH must be a positive number, got ${JSON.stringify(process.env.CELL_WIDTH)}`);
 const widths = cellWidth !== null ? [cellWidth] : [390, 1280];
 for (const width of widths) for (const dark of [false, true]) for (const kind of (process.env.CELL_KIND ? [process.env.CELL_KIND] : ['alarms', 'runs', 'config']).filter(k => k !== 'findings')) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
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
   const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
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
     await settle();
     // At40px, noninteractive text is intentionally recoverable by widening.
     // The120px and wider oracle is strict: no clipping may mask a repair.
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
   const narrowPaint = await pixelStrip(page,kind,net); // actual restored40px text-only columns
   net = await page.addStyleTag({content:'td {overflow:visible !important}'});
   await page.evaluate(() => { const t=window.__fixtureTables.at(-1); t.setColumnSizing(Object.fromEntries(t.getAllLeafColumns().map(c=>[c.id,Math.max(120,c.columnDef.minSize??40)]))); });
   await settle();
   const paint = await pixelStrip(page,kind,net);
   // Real keyboard minima and drag, including a restored one-pixel view.
   const interactive = kind === 'runs' ? 'actions' : kind === 'config' ? 'actions' : 'status';
   await page.evaluate(id=>{const t=window.__fixtureTables.at(-1);t.setColumnOrder([id,...t.getAllLeafColumns().map(c=>c.id).filter(x=>x!==id)]);},interactive); await settle();
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
   await settle();
   const box = await separator.boundingBox();
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await settle();
   assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum, 'native drag cannot cross declared minimum');
   }
   await net.evaluate(el => el.remove()); // net ON: controls must still work.
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
    await settle(); await target.scrollIntoViewIfNeeded(); await target.focus();
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
    await remZoom.evaluate(el=>el.remove()); await settle();
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
   assert.deepEqual(errors, [], 'no browser errors');
   console.log(`${kind}/${width}/${dark ? 'dark' : 'light'}: completed8 sizing/text legs + native controls/menu/minimum`,{paint,narrowPaint});

  } finally { await page.close(); }
 }
 // portal#2118 item 5: the findings table has no interactive column, so it gets its own geometry pass.
 // Severity (six revealed markers, and an 80-character plain label) and text stay inside their cells
 // (#2115 QA F1, #2119). The control strips severity's wrap and must see the overflow.
 if (!process.env.CELL_KIND || process.env.CELL_KIND === 'findings') for (const width of widths) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
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
   await page.locator('[data-testid="finding-severity"]').first().waitFor();
   // Fonts first: a late webfont would change the measured glyph boxes (portal#2125 item 5).
   const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
   // Pixels of glyph box outside the owning td, per field: horizontal AND vertical (portal#2125 item 4).
   const escapes = () => page.locator('tbody td [data-testid^="finding-"]').evaluateAll(fields => fields.map(f => {
    const cell = f.closest('td').getBoundingClientRect(); let px = 0;
    const range = document.createRange(); range.selectNodeContents(f);
    for (const r of range.getClientRects()) px = Math.max(px, cell.left - r.left, r.right - cell.right, cell.top - r.top, r.bottom - cell.bottom);
    return { field: f.dataset.testid, row: f.closest('tr').querySelector('[data-testid="finding-id"]').textContent, px: Math.round(px) };
   }));
   // One failure strategy: every check on this leg queues into `failures`, so one leg never hides another (portal#2125 item 3).
   const legFailuresBefore = failures.length;
   await settle();
   const clean = await escapes();
   const severities = clean.filter(x => x.field === 'finding-severity').length;
   if (severities !== 2) failures.push(`${leg}: both severity triggers rendered, saw ${severities}`);
   const out = clean.filter(x => x.px > 0.5);
   if (out.length) failures.push(`${leg}: findings field escapes its cell ${JSON.stringify(out)}`);
   const control = await page.addStyleTag({ content: '[data-testid="finding-severity"] { overflow-wrap: normal !important; word-break: normal !important; }' });
   await settle();
   const dirty = (await escapes()).filter(x => x.field === 'finding-severity' && x.px > 0.5).map(x => x.row).sort();
   if (JSON.stringify(dirty) !== JSON.stringify(['markers', 'plain'])) failures.push(`${leg}: negative control (severity wrap stripped) must be detected for both triggers, saw ${JSON.stringify(dirty)}`);
   await control.evaluate(el => el.remove());
   if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) failures.push(`${leg}: document overflow`);
   if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/${leg.replaceAll('/', '-')}.png`, fullPage: true });
   if (errors.length) failures.push(`${leg}: browser errors ${JSON.stringify(errors)}`);
   // The success line only prints for a leg that queued nothing.
   if (failures.length === legFailuresBefore) console.log(`${leg}: severity and text inside their cells (both axes); negative control detected`, clean);
   else console.log(`${leg}: FAILED, ${failures.length - legFailuresBefore} check(s) queued`, clean);
  } finally { await page.close(); }
 }
 assert.deepEqual(failures, []);
} finally { await browser?.close(); await server.close(); }
