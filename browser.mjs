import {chromium} from '/tmp/coco1520-portal/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';
const fixtures=JSON.parse(fs.readFileSync('/tmp/coco1520-fixture-result.log','utf8').trim().split('\n').at(-1));const alpha=fixtures[0],beta=fixtures[1];
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const redirects=[];page.on('response',r=>{if(r.url().includes('/app/u/'))redirects.push({path:new URL(r.url()).pathname,status:r.status(),location:r.headers()['location']})});
const base='http://localhost:19701';
await page.goto('http://localhost:19700/auth/dev/login?email=alpha-admin@e2e.test');await page.waitForURL(base+'/app**',{timeout:60000});
async function theme(t){await page.waitForTimeout(1500);await page.getByRole('button',{name:'Theme',exact:true}).last().click();await page.getByRole('menuitemradio',{name:t==='light'?'Light':'Dark',exact:true}).click();await page.waitForTimeout(150);assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('dark')),t==='dark')}
const results=[];
const response=await page.goto(base+'/app/u/'+alpha.urn);await page.waitForURL(base+`/app/memories/${alpha.memoryId}/nodes/${alpha.nodeId}`);assert.equal(response.status(),200);assert.ok(redirects.some(x=>x.status===307&&x.location===`/app/memories/${alpha.memoryId}/nodes/${alpha.nodeId}`));
await page.getByRole('heading',{name:/QA1520 readable action entry/}).waitFor();
for(const t of ['light','dark']){await theme(t);await page.screenshot({path:`/tmp/coco1520-readable-${t}.png`});results.push({case:'readable',theme:t,status:200,path:new URL(page.url()).pathname})}
const messages=[];
for(const [kind,urn] of [['foreign',beta.urn],['missing','hrn:action:e2e-alpha:qa1520-team:no-such-code'],['malformed','hrn:action:e2e-alpha:qa1520-team:bad!code']]){
 const r=await page.goto(base+'/app/u/'+urn);assert.equal(r.status(),404);const text=(await page.locator('body').innerText());assert.ok(text.includes('No resource found for "'+urn+'", or you do not have access to it.'));assert.ok(!text.includes('QA1520 readable action entry'));
 const diagnostic=text.slice(text.indexOf('No resource found'));messages.push(diagnostic.replaceAll(urn,'<URN>'));
 for(const t of ['light','dark']){await theme(t);await page.screenshot({path:`/tmp/coco1520-${kind}-${t}.png`});results.push({case:kind,theme:t,status:r.status(),diagnostic:diagnostic.replaceAll(urn,'<URN>')})}
}
assert.equal(messages[0],messages[1]);assert.equal(messages[1],messages[2]);
await page.goto(base+'/qa1520');const chip=page.locator('a[href="/app/u/'+alpha.urn+'"]');await chip.waitFor({state:'visible'});assert.equal(await chip.locator('span').nth(1).innerText(),'action:');assert.ok(!(await chip.innerText()).includes('unknown'));
for(const t of ['light','dark']){await theme(t);await page.screenshot({path:`/tmp/coco1520-chip-${t}.png`});results.push({case:'chip-isolated-component-harness',theme:t,text:await chip.innerText(),href:await chip.getAttribute('href')})}
// Positive foreign fixture control under its own tenant, in a separate browser context.
const ctx=await browser.newContext();const bp=await ctx.newPage();await bp.goto('http://localhost:19700/auth/dev/login?email=beta-admin@e2e.test');await bp.waitForURL(base+'/app**');await bp.goto(base+'/app/u/'+beta.urn);await bp.waitForURL(base+`/app/memories/${beta.memoryId}/nodes/${beta.nodeId}`);results.push({case:'beta-own-positive',path:new URL(bp.url()).pathname});await ctx.close();
assert.deepEqual(errors,[]);console.log(JSON.stringify({browserVersion:browser.version(),portal:'7a495a6934fa763c7b147fe18a356232b6c25673',server:'53d02f371269534a0877a1238aff7f8e54aace84',results,redirects,errors},null,2));await browser.close();
