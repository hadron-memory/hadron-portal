// Real components + Chromium; synthetic read fixtures, no API/QA claim.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const output=process.env.TOKEN_USE_SHOTS;if(output)await mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
try{
 await server.listen();const origin=server.resolvedUrls.local[0];
 const css=await(await fetch(new URL('src/app.css?direct',origin))).text();browser=await chromium.launch({headless:true});
 for(const width of [390,1280])for(const theme of ['light','dark'])for(const variant of ['add','move']){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__blank1908',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Token use layout</title>'}));
  for(let attempt=0;;attempt++)try{
   await page.goto(new URL('/__blank1908',origin).href);
   await page.evaluate(({css,theme})=>{document.documentElement.classList.toggle('dark',theme==='dark');document.body.innerHTML=`<style>${css}</style><main id="col" class="text-zinc-900 dark:text-white" style="max-width:1000px;margin:24px"></main>`;document.body.style.background=theme==='dark'?'#09090b':'#fafafa';},{css,theme});
   await page.evaluate(async variant=>{const {mountUsage}=await import('/src/lib/test/fixtures/usage-projection-harness.ts');mountUsage(document.getElementById('col'),variant);},variant);
   const heading=variant==='add'?'After adding 3 workers':'After moving Ruth to Chosen target';await page.getByRole('heading',{name:heading,exact:false}).waitFor();
   assert.equal(await page.locator('#usage-add').inputValue(),variant==='add'?'3':'1');
   if(variant==='move'){assert.equal(await page.locator('#usage-worker').inputValue(),'Ruth');assert.ok((await page.locator('#usage-target').inputValue()).includes('Chosen target'));await page.getByRole('heading',{name:'Target after · Chosen target',exact:true}).waitFor();}
   const text=await page.locator('main').innerText();assert.ok(text.includes('34%'));assert.ok(text.includes('<1%/h'));assert.ok(!text.includes('34–34%'));assert.ok(!text.includes('<1–<1%'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   if(output)await page.screenshot({path:`${output}/fix-${variant}-${theme}-${width}.png`,fullPage:true});
   break;
  }catch(e){if(attempt>=5||e?.name==='AssertionError'||!/Execution context was destroyed|navigation/i.test(String(e)))throw e;}
  await page.close();
 }
 console.log('PASS: 8 token-use component layouts, retained questions and range formatting, 390/1280 light/dark');
}finally{await browser?.close();await server.close();}
