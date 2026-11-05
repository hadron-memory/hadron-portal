// portal#1551: native Enter/Space, real TaskPlanning + shared DataTable + compiled
// CSS. Synthetic loader/HTTP/Kit stores; independent QA owns its separate run.
// RELATION_FOCUS_SHOTS=<directory> captures author evidence. No server writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
const output = process.env.RELATION_FOCUS_SHOTS;
if (output) await mkdir(output, { recursive: true });
const alias = { $lib: resolve('src/lib') };
for (const name of ['forms', 'stores', 'navigation', 'environment', 'state']) alias[`$app/${name}`] = resolve(`src/lib/test/stubs/app-${name}.ts`);
const server = await createServer({ configFile: false, optimizeDeps: { exclude: ['sveltekit-superforms', '@tanstack/svelte-table'] }, plugins: [tailwindcss(), svelte()], resolve: { alias, dedupe: ['svelte'], conditions: ['browser'] }, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    for (const direction of ['Waits for', 'Holds up']) for (const key of ['Enter', 'Space']) for (const newer of [false, true]) {
      const label = `${width}-${theme}-${direction.replaceAll(' ', '-')}-${key}-${newer ? 'newer' : 'handoff'}`;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let release; let requested;
      const held = new Promise(r => release = r); const requestStarted = new Promise(r => requested = r);
      await page.route('**/relations?*', async route => {
        assert.equal(new URL(route.request().url()).searchParams.get('offset'), '200');
        requested(); await held;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'ok', value: {
          items: [{ id: 'appended', appId: 'app', title: 'Task appended', handle: 'AT1.appended', status: 'PENDING' }], hasMore: false,
        } }) });
      });
      await page.route('**/__relation_focus', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Relation focus</title>' }));
      await page.goto(new URL('/__relation_focus', origin).href);
      await page.evaluate(({ css, theme }) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.body.innerHTML = `<style>${css}</style><main style="margin:16px;max-width:1100px"><div id="fixture"></div><button id="newer">Later keyboard target</button></main>`;
        document.body.style.background = theme === 'dark' ? '#09090b' : '#fafafa';
        document.body.style.color = theme === 'dark' ? '#fafafa' : '#18181b';
      }, { css, theme });
      await page.evaluate(async () => { const h = await import('/src/lib/test/fixtures/relation-focus-harness.ts'); h.mountRelationFocus(document.getElementById('fixture')); });
      const trigger = page.getByRole('button', { name: `Load more ${direction}`, exact: true });
      await trigger.focus(); await page.keyboard.press(key); await requestStarted;
      if (newer) await page.locator('#newer').focus();
      release(); await trigger.waitFor({ state: 'detached' });
      const filter = page.getByRole('textbox', { name: 'Filter loaded relations…', exact: true });
      if (newer) {
        await page.waitForTimeout(30); assert.equal(await page.locator('#newer').evaluate(el => el === document.activeElement), true, label);
      } else {
        await filter.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Filter loaded relations…');
        // Reach an earlier and an appended row by actual Tab traversal through
        // the shared table, using its existing filter to select the loaded row.
        for (const title of ['Task old-wait-0', 'Task appended']) {
          await filter.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(title);
          let reached = false;
          for (let i = 0; i < 45; i++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(title => document.activeElement?.tagName === 'A' && document.activeElement.textContent === title, title);
            if (reached) break;
          }
          assert.equal(reached, true, `${label}: keyboard reaches ${title}`);
        }
        await filter.focus();
      }
      if (output) await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
      console.log(`ok ${label}: final page appended, exhausted; ${newer ? 'newer focus preserved' : 'filter focused; old/new rows keyboard reachable'}`);
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
