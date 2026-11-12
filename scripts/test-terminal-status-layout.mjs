// #2029 author geometry pin: real component and generated CSS, synthetic data.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server:{host:'127.0.0.1',port:0},plugins:[{
 name:'terminal-containment-mutant',enforce:'pre',transform(code,id){
  if(process.env.TERMINAL_CONTAINMENT_MUTANT==='1' && id.endsWith('/TerminalStatus.svelte'))
   return code.replace('inline-flex max-w-full min-w-0 flex-wrap','inline-flex flex-wrap');
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
  const pill=page.locator('#terminal span[title]');await pill.waitFor();
  const fullBefore=await page.locator('#full').innerHTML();
  for(const width of [220,140,320,220]) {
   await page.locator('col').first().evaluate((el,width)=>{el.style.width=`${width}px`;el.closest('table').style.width=`${width+220}px`},width);
   const geometry=await pill.evaluate(el=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}};
    const td=el.closest('td'),outer=el.parentElement;return {cell:rect(td),outer:rect(outer),pill:rect(el),title:el.title,text:el.textContent,overflow:getComputedStyle(el).textOverflow,scroll:el.scrollWidth,client:el.clientWidth,age:outer.textContent};
   });results.push({dark,width,...geometry});
   if(process.env.TERMINAL_SHOTS)await page.screenshot({path:`${process.env.TERMINAL_SHOTS}/${dark?'dark':'light'}-${width}.png`});
   assert.equal(geometry.title,'Dark: Agent not running (plain shell)');
   assert.equal(geometry.text,geometry.title);assert.match(geometry.age,/16/);
   assert.ok(geometry.outer.right<=geometry.cell.right+0.5,`compact wrapper bleeds at ${width}px: ${JSON.stringify(geometry)}`);
   assert.ok(geometry.pill.right<=geometry.cell.right+0.5,'pill bounded');
   assert.equal(geometry.overflow,'ellipsis');
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
