import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const out='docs/evidence/1902';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {for(const width of [1280,390])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:950},colorScheme:theme});const page=await context.newPage();
 await page.goto('http://localhost:14902/auth/dev/login?email=alpha-admin%40e2e.test&redirect='+encodeURIComponent('/app/memories/aab21337f9a31d96acd7765200481108/nodes/4d9a8063b29ab356c63f6c060f8e1523'));
 if(width===390){await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();}
 else {const settings=page.getByRole('tab',{name:'Settings',exact:true});await settings.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[role=tab]')].some(el=>el.textContent?.trim()==='Settings'&&'__svelte_meta' in el));await settings.click();}
 await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('menuitemradio',{name:theme==='dark'?'Dark':'Light',exact:true}).click();
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#editName').fill('New Name');
 assert.equal(await page.locator('#editLoc').inputValue(),'refresh-parent:old');
 await page.getByRole('button',{name:'Refresh URN from name',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#editLoc')?.value==='refresh-parent:new-name-2');
 assert.equal(await page.locator('[data-testid=node-loc-move-warning]').textContent(),'Saving moves this node and its children to the new URN. Links written as the old URN are not updated. Old URNs of minted nodes keep working; others may stop working.');
 assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),theme==='dark');
 await page.locator('#editLoc').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/refresh-${width}-${theme}.png`});
 assert.equal(await page.locator('#editLoc').inputValue(),'refresh-parent:new-name-2');
 console.log(`PASS ${width} ${theme}: saved parent + sibling suffix, draft-only Refresh, exact D1 warning`);
 if(width===390&&theme==='dark'){await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editName'));console.log('PASS real Save accepted through existing updateMeta/move path');}
 await context.close();
}}finally{await browser.close();}
