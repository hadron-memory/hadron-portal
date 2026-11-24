// #2029 author geometry pin: real component and generated CSS, synthetic data.
import assert from 'node:assert/strict';
// mkdir and writeFile are both imported here: the artifact write in the finally block uses both.
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
const server = await createServer({server:{host:'127.0.0.1',port:0},plugins:[{
 name:'terminal-containment-mutant',enforce:'pre',transform(code,id){
  if(process.env.TERMINAL_CONTAINMENT_MUTANT==='1' && id.endsWith('/TerminalStatus.svelte')) {
   const mutated=code.replace('inline-flex max-w-full min-w-0 flex-wrap','inline-flex flex-wrap');
   assert.notEqual(mutated,code,'containment mutant must change the production component');
   console.log('TERMINAL_CONTAINMENT_MUTANT_APPLIED');
   return mutated;
  }
 }
}]});
// What the fixture renders for a terminal report (status dark, reason bare_shell): one place for the
// text the assertions compare against.
const TITLE='Dark: Agent not running (plain shell)';
const FULL_TEXT='Dark\nAgent not running (plain shell)\nLast turn: not known\nchecked 16 min. ago';
let browser;
const results=[];
// Set in the finally block when closing the browser or server, or writing the artifact, fails. A failed
// body throws past the code after the finally, so its own failure is the one reported; this flag only
// decides the outcome of a body that passed.
let teardownFailed=false;
try {
 await server.listen(); const origin=server.resolvedUrls.local[0];
 const css=await (await fetch(new URL('/src/app.css?direct',origin))).text();
 browser=await chromium.launch({headless:true});
 if(process.env.TERMINAL_SHOTS) await mkdir(process.env.TERMINAL_SHOTS,{recursive:true});
 for(const dark of [false,true]) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.route('**/__terminal_fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Terminal containment fixture</title>'}));
  await page.goto(new URL('/__terminal_fixture',origin).href);
  await page.evaluate(({css,dark})=>{
   document.head.innerHTML=`<style>${css}</style>`;document.documentElement.classList.toggle('dark',dark);
   document.body.className='bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white';
   document.body.innerHTML='<main class="p-4"><table style="table-layout:fixed;width:440px"><colgroup><col style="width:220px"><col style="width:220px"></colgroup><tbody><tr><td class="border px-4 py-2.5"><div id="terminal"></div></td><td class="border px-4 py-2.5"><a href="#task">Synthetic assigned task</a><button>Task action</button></td></tr></tbody></table><div id="full"></div><div id="empty"></div></main>';
  },{css,dark});
  await page.evaluate(async()=>{
   const {mountTerminalFixture:mount}=await import('/src/lib/test/fixtures/terminal-status-harness.ts');
   window.stopTerminal=mount(document.getElementById('terminal'),'reported');
   window.stopFull=mount(document.getElementById('full'),'reported',false);
  });
  const pill=page.locator('#terminal span[title]');await pill.waitFor({state:'attached'});
  // The full form, asserted as mounted, after every compact resize below, and once more after the loop.
  await page.waitForFunction(()=>document.getElementById('full').innerText.includes('checked')); // the form's last line, so the whole text has rendered
  assert.equal(await page.locator('#full').innerText(),FULL_TEXT,'full form as mounted');
  for(const width of [220,140,320,220]) {
   await page.locator('col').first().evaluate((el,width)=>{el.style.width=`${width}px`;el.closest('table').style.width=`${width+220}px`},width);
   const geometry=await pill.evaluate(el=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
    const td=el.closest('td'),outer=el.parentElement,age=el.nextElementSibling;
    const ageRange=document.createRange();ageRange.selectNodeContents(age);
    const style=getComputedStyle(el);return {cell:rect(td),outer:rect(outer),pill:rect(el),title:el.title,text:el.textContent,overflow:getComputedStyle(el).textOverflow,scroll:el.scrollWidth,client:el.clientWidth,age:outer.textContent,ageBounds:rect(ageRange),lineHeight:parseFloat(style.lineHeight),display:style.display,visibility:style.visibility,opacity:style.opacity};
   });results.push({dark,width,...geometry});
   if(process.env.TERMINAL_SHOTS)await page.screenshot({path:`${process.env.TERMINAL_SHOTS}/${dark?'dark':'light'}-${width}.png`});
   assert.equal(geometry.title,TITLE);
   assert.equal(geometry.text,geometry.title);assert.match(geometry.age,/16/);
   assert.ok(geometry.outer.right<=geometry.cell.right+0.5,`compact wrapper bleeds at ${width}px: ${JSON.stringify(geometry)}`);
   assert.ok(geometry.pill.right<=geometry.cell.right+0.5,'pill bounded');
   assert.equal(geometry.overflow,'ellipsis');
   assert.ok(geometry.pill.width>50,'pill retains visible width');
   assert.ok(geometry.pill.height>0 && geometry.pill.height<2*geometry.lineHeight,'pill remains one visible line');
   assert.notEqual(geometry.display,'none');assert.equal(geometry.visibility,'visible');assert.equal(geometry.opacity,'1');
   assert.ok(geometry.pill.left>=geometry.cell.left,'pill starts inside cell');
   assert.ok(geometry.ageBounds.left>=geometry.cell.left && geometry.ageBounds.right<=geometry.cell.right+0.5,'age glyphs stay inside cell');
   if(width===140)assert.ok(geometry.scroll>geometry.client,'narrow pill actually truncates');
   if(width===320)assert.ok(geometry.scroll<=geometry.client,'wider pill exposes the full value');
   // A Range measures untruncated text, not painted glyphs. Compare actual
   // neighboring pixels with the terminal hidden/visible instead.
   const td=pill.locator('xpath=ancestor::td');const box=await td.boundingBox();
   const clip={x:Math.ceil(box.x+box.width+1),y:Math.ceil(box.y),width:40,height:Math.floor(box.height)};
   const visible=await page.screenshot({clip});
   await page.locator('#terminal').evaluate(el=>el.style.visibility='hidden');
   const hidden=await page.screenshot({clip});
   await page.locator('#terminal').evaluate(el=>el.style.visibility='');
   assert.ok(visible.equals(hidden),'terminal paints no pixels into neighboring Task');
   await pill.hover(); // existing full-value title remains on the un-clipped pill.
   assert.equal(await pill.getAttribute('title'),TITLE,'hover leaves the full-value title');
   await page.getByRole('button',{name:'Task action'}).click();
   // Without this reset, iterations after the first pass trivially: the hash is already #task.
   await page.evaluate(()=>{location.hash=''});
   await page.getByRole('link',{name:'Synthetic assigned task'}).click();
   assert.equal(new URL(page.url()).hash,'#task');
   // A resize that changed the full form and then recovered would pass a check made only at the ends.
   assert.equal(await page.locator('#full').innerText(),FULL_TEXT,`full form unchanged after compact resize to ${width}px`);
  }
  assert.equal(await page.locator('#full').innerText(),FULL_TEXT,'full form after compact resizing');
  for(const mode of ['hidden','not-reported']) {
   await page.evaluate(async mode=>{const {mountTerminalFixture}=await import('/src/lib/test/fixtures/terminal-status-harness.ts');window.stopEmpty=mountTerminalFixture(document.getElementById('empty'),mode)},mode);
   assert.equal(await page.locator('#empty').innerText(),mode==='hidden'?'':'Not reported');
   await page.evaluate(async()=>await window.stopEmpty());
  }
  // Each fixture unmounts even if the other's unmount fails; a failure of either still fails the run.
  const unmounts=await page.evaluate(async()=>(await Promise.allSettled([(async()=>window.stopTerminal())(),(async()=>window.stopFull())()])).map(r=>r.status==='fulfilled'?'fulfilled':`rejected: ${String(r.reason)}`));
  assert.deepEqual(unmounts,['fulfilled','fulfilled'],`both fixtures unmount cleanly: ${JSON.stringify(unmounts)}`);
  await page.close();
 }
} finally {
 // Close owned resources first, then write the artifact; a failure in either
 // step must neither skip the other nor replace the original failure.
 // Each close is wrapped so a synchronous throw cannot escape the collection.
 const cleanup=await Promise.allSettled([(async()=>browser?.close())(),(async()=>server.close())()]);
 let artifactFailed=false;
 if(process.env.TERMINAL_SHOTS) {
  try{await mkdir(process.env.TERMINAL_SHOTS,{recursive:true});await writeFile(`${process.env.TERMINAL_SHOTS}/geometry.json`,JSON.stringify(results,null,2))}
  catch(e){artifactFailed=true;console.error('could not write geometry artifact:',e)}
 }
 for(const r of cleanup) if(r.status==='rejected') console.error('teardown failed:',r.reason);
 // A green body with a broken teardown or a missing artifact must not exit 0 (CI uploads that artifact).
 if(artifactFailed || cleanup.some(r=>r.status==='rejected')) teardownFailed=true;
}
// Reached only when the body passed. Report a teardown or artifact failure and stop: never print PASS over one.
if(teardownFailed) {
 console.error('terminal containment body passed, but teardown or the artifact write failed (see above)');
 process.exit(1);
}
console.log('Terminal compact geometry, full-value title, Task controls, null/not-reported and full form PASS');

// The normal command (including CI) must prove the production constraint is
// discriminating. An arbitrary child error is not a successful mutant kill.
if(process.env.TERMINAL_CONTAINMENT_MUTANT!=='1') {
 const {TERMINAL_SHOTS,...env}=process.env;
 const mutant=spawnSync(process.execPath,[import.meta.filename],{
  env:{...env,TERMINAL_CONTAINMENT_MUTANT:'1'},encoding:'utf8',timeout:60000,
 });
 assert.equal(mutant.status,1,`mutant must fail normally: ${mutant.error ?? mutant.stderr}`);
 assert.ok(mutant.stdout.includes('TERMINAL_CONTAINMENT_MUTANT_APPLIED'),'production mutant applied');
 assert.ok(mutant.stderr.includes('compact wrapper bleeds at 220px'),'mutant fails the containment oracle');
 console.log('Production containment mutant applied and killed by geometry pin');
}
