// Focused real-Chromium geometry on the actual mounted TaskPlanning + DataTable
// and production CSS. Form/navigation adapters are inert: this does not prove
// authenticated routing, mutations or server authority; independent QA owns those.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const fixture = `
import '/src/app.css';
import { mount, unmount, tick } from 'svelte';
import TaskPlanning from '/src/lib/components/agent-tasks/TaskPlanning.svelte';
let component;
window.scenario = async (status = 'PENDING', canWrite = true, legacy = false) => {
  if (component) await unmount(component);
  localStorage.clear();
  if (legacy) localStorage.setItem('hadron:views:v1:task-dependencies', JSON.stringify([{
    id: 'legacy', name: 'Old arrangement', isDefault: true, listKey: 'task-dependencies',
    view: { columnOrder: ['direction','title','handle','status','remove'], columnVisibility: { remove: false } }
  }]));
  const choice = (id) => ({ id, appId: 'app', title: 'A readable task title ' + id, handle: 'AT1.23', status: 'PENDING' });
  component = mount(TaskPlanning, { target: document.querySelector('main'), props: {
    task: { id: 'subject', handle: 'AT1', appId: 'app', status, priority: 3 }, appId: 'app', canWrite,
    dependencies: { kind: 'ok', value: { blockedBy: { items: [choice('first'),choice('second')], hasMore: false }, blocks: { items: [choice('dependent')], hasMore: false } } }
  } });
  await tick(); await new Promise(r => setTimeout(r, 50));
};
await window.scenario();
window.fixtureReady = true;
`;
const aliases = Object.fromEntries(['navigation','environment','stores','state','forms'].map(name => [`$app/${name}`, resolve(`src/lib/test/stubs/app-${name}.ts`)]));
const server = await createServer({
  configFile: false, plugins: [tailwindcss(), svelte(), {
    name: 'relations-phone-fixture',
    resolveId(id) { if (id === '/__relations-phone-entry.ts') return '\0relations-phone-entry'; },
    load(id) { if (id === '\0relations-phone-entry') return fixture; },
    configureServer(s) { s.middlewares.use('/__relations-phone', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__relations-phone', '<html><body><main style="margin:40px;min-width:0"></main><script type="module" src="/__relations-phone-entry.ts"></script></body></html>'));
    }); },
  }], resolve: { alias: { $lib: resolve('src/lib'), ...aliases, '$env/dynamic/public': resolve('src/lib/test/stubs/env-dynamic-public.ts') } },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(e));
  await page.goto(new URL('/__relations-phone', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => window.fixtureReady);
  for (const width of [390, 1280]) for (const dark of [false, true]) for (const legacy of [false, true]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async ({ dark, legacy }) => { document.documentElement.classList.toggle('dark', dark); await window.scenario('PENDING', true, legacy); }, { dark, legacy });
    const boxes = await page.locator('form[action="?/removeBlocker"] button').evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }));
    assert.equal(boxes.length, 2);
    for (const box of boxes) assert.ok(box.left >= 0 && box.right <= width && box.width > 0, `Remove outside ${width}px at scroll 0, legacy=${legacy}: ${JSON.stringify(box)}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'document overflow');
    assert.equal(await page.locator('tbody tr').last().locator('form').count(), 0, 'Holds up gained Remove');
    const title = page.getByRole('link', { name: 'A readable task title first', exact: true });
    await title.scrollIntoViewIfNeeded();
    assert.ok(await title.isVisible());
    const remove = page.locator('form[action="?/removeBlocker"] button').first();
    await remove.focus(); assert.ok(await remove.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Tab'); assert.ok(await title.evaluate(el => el === document.activeElement), 'Remove must precede its row title in keyboard order');
    if (process.env.HADRON_LAYOUT_SHOTS && !legacy) {
      await mkdir(process.env.HADRON_LAYOUT_SHOTS, { recursive: true });
      await page.screenshot({ path: resolve(process.env.HADRON_LAYOUT_SHOTS, `relations-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
    }
  }
  for (const [status, canWrite] of [['STARTED',true],['FINISHED',true],['CANCELLED',true],['PENDING',false]]) {
    await page.evaluate(async ([status, writable]) => window.scenario(status, writable), [status, canWrite]);
    assert.equal(await page.locator('form[action="?/removeBlocker"]').count(), 0);
  }
  console.log('PASS: actual mounted grid at390/1280, light/dark, legacy views, geometry, keyboard and restricted rows; no authenticated write claim.');
} finally { await browser?.close(); await server.close(); }
