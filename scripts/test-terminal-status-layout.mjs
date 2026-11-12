// #2029 author geometry pin: real component and generated CSS, synthetic data.
import assert from 'node:assert/strict';
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
let browser;
const results=[];
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
   window.stopTerminal=mount(document.getElementById('terminal'),'dark');
   window.stopFull=mount(document.getElementById('full'),'dark',false);
  });
  const pill=page.locator('#terminal span[title]');await pill.waitFor({state:'attached'});
  const fullBefore=await page.locator('#full').innerHTML();
  for(const width of [220,140,320,220]) {
   await page.locator('col').first().evaluate((el,width)=>{el.style.width=`${width}px`;el.closest('table').style.width=`${width+220}px`},width);
   const geometry=await pill.evaluate(el=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
    const td=el.closest('td'),outer=el.parentElement,age=el.nextElementSibling;
    const ageRange=document.createRange();ageRange.selectNodeContents(age);
    const style=getComputedStyle(el);return {cell:rect(td),outer:rect(outer),pill:rect(el),title:el.title,text:el.textContent,overflow:getComputedStyle(el).textOverflow,scroll:el.scrollWidth,client:el.clientWidth,age:outer.textContent,ageBounds:rect(ageRange),lineHeight:parseFloat(style.lineHeight),display:style.display,visibility:style.visibility,opacity:style.opacity};
   });results.push({dark,width,...geometry});
   if(process.env.TERMINAL_SHOTS)await page.screenshot({path:`${process.env.TERMINAL_SHOTS}/${dark?'dark':'light'}-${width}.png`});
   assert.equal(geometry.title,'Dark: Agent not running (plain shell)');
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
   assert.equal(await page.locator('#full').innerHTML(),fullBefore,'compact resizing leaves full form unchanged');
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
   await page.getByRole('button',{name:'Task action'}).click();
   await page.getByRole('link',{name:'Synthetic assigned task'}).click();
   assert.equal(new URL(page.url()).hash,'#task');
  }
  assert.equal(await page.locator('#full').innerText(),'Dark\nAgent not running (plain shell)\nLast turn: not known\nchecked 16 min. ago');
  for(const mode of ['hidden','not-reported']) {
   await page.evaluate(async mode=>{const {mountTerminalFixture}=await import('/src/lib/test/fixtures/terminal-status-harness.ts');window.stopEmpty=mountTerminalFixture(document.getElementById('empty'),mode)},mode);
   assert.equal(await page.locator('#empty').innerText(),mode==='hidden'?'':'Not reported');
   await page.evaluate(async()=>await window.stopEmpty());
  }
  await page.close();
 }
} finally {
 if(process.env.TERMINAL_SHOTS)await writeFile(`${process.env.TERMINAL_SHOTS}/geometry.json`,JSON.stringify(results,null,2));
 await browser?.close();await server.close();
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
