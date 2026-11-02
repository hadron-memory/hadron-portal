// portal#1410: real component + compiled CSS, real Chromium target measurements.
// No server/auth fixture: independent QA owns the signed-in route checks.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host:'127.0.0.1', port:0 } });
let browser;
try {
 await server.listen();
 const origin=server.resolvedUrls.local[0];
 const css=await (await fetch(new URL('src/app.css?direct',origin))).text();
 browser=await chromium.launch({headless:true});
 for(const width of [390,1280]) for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.route('**/__blank',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Team chat chips</title>'}));
  for(let attempt=0;;attempt++) {
   try {
    await page.goto(new URL('/__blank',origin).href);
    await page.evaluate(({css,theme,width})=>{
     document.documentElement.classList.toggle('dark',theme==='dark');
     document.documentElement.style.background = document.body.style.background = theme === 'dark' ? '#09090b' : '#fafafa';
     document.body.innerHTML=`<main id="fixture" style="margin:40px;width:${width === 390 ? 308 : 1000}px"></main>`;
     const style=document.createElement('style');style.textContent=css;document.head.append(style);
    },{css,theme,width});
    await page.evaluate(async()=>{const {mountTeamChatChips}=await import('/src/lib/test/fixtures/team-chat-chips-harness.ts');mountTeamChatChips(document.getElementById('fixture'));});
    break;
   } catch(e) {if(attempt>=5||!/Execution context was destroyed|navigation/i.test(String(e)))throw e;}
  }
  await page.locator('[data-testid="team-chat-tag"]').first().waitFor();
  const originalStatus=await page.locator('[data-testid="team-chat-filter-status"]').elementHandle();
  const measure=async()=>page.locator('[data-testid="team-chat-filter"] button, [data-testid="team-chat-tag"]').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent.trim(),height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,font:parseFloat(getComputedStyle(n).fontSize)})));
  for(const stage of ['all','team']) {
   if(stage==='team') {
    await page.locator('[data-testid="team-chat-tag"]').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='team-chat-filter-active', null, {timeout:5000});
    assert(await originalStatus.evaluate(node=>node.isConnected),'live region must survive keyed remount');
    assert.equal(await page.locator('[data-testid="team-chat-filter-status"]').getAttribute('aria-live'),'polite');
    assert.match(await page.locator('[data-testid="team-chat-filter-status"]').textContent(),/team.example/);
   }
   const rows=await measure(); assert(rows.length>=3); console.log(`${width}/${theme}/${stage}: ${JSON.stringify(rows)}`);
   for(const row of rows) {assert(row.height>=24,`${width}/${theme}/${stage}: ${JSON.stringify(row)} below 24px`);assert(row.width>=24);assert(row.font>=11&&row.font<=12);}
   if(process.env.CHAT_CHIPS_SHOTS) {await mkdir(process.env.CHAT_CHIPS_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.CHAT_CHIPS_SHOTS}/${width}-${theme}-${stage}.png`});}
  }
  await page.close();
 }
} finally {await browser?.close();await server.close();}
