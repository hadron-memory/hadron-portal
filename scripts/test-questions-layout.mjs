// portal#2235: the App's Questions list must stay inside the screen at a phone (390px) and a desktop (1280px), in light and in
// dark. jsdom has no layout engine, so this is real Chromium, like test-tickers-layout: the real page is mounted through Vite
// with the compiled app.css, in the 308px content column a 390px viewport leaves.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:questions-layout            (screenshots land in shots/questions-<view>-<width>-<scheme>.png)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The first import of the harness makes Vite re-optimize dependencies and reload the page; a setup that a reload interrupts starts again.
const RELOADED = /Execution context was destroyed|navigation/i;
const VIEWS = ['list', 'empty-no-log', 'setup-single', 'setup-withheld', 'setup-refused', 'empty-no-match', 'failed'];

async function mountView(page, origin, css, width, view) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 1000}px; margin: 40px; }` });
      await page.evaluate(async (view) => {
        const { mountQuestions } = await import('/src/lib/test/fixtures/questions-harness.ts');
        mountQuestions(document.getElementById('col'), view);
      }, view);
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

mkdirSync('shots', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) {
    for (const view of VIEWS) {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await mountView(page, origin, css, width, view);
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');
        await page.waitForSelector('h1');
        const label = `${view} (${scheme}) at ${width}px`;
        const got = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const scroller = document.querySelector('[data-testid="data-table-scroller"]');
          const statusRegions = document.querySelectorAll('[role=status]').length;
          const heads = [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
          const controls = [...document.querySelectorAll('select, nav a, form button, input[type=checkbox]')].map((el) => {
            const b = el.getBoundingClientRect();
            return { tag: el.tagName, left: b.left, right: b.right };
          });
          return { vw, scrollWidth: document.documentElement.scrollWidth, scroller: !!scroller, statusRegions, heads, controls };
        });
        assert.equal(got.scrollWidth, width, `${label}: the page overflows sideways (${got.scrollWidth} > ${width})`);
        for (const c of got.controls) assert.ok(c.left >= 0 && c.right <= width, `${label}: a ${c.tag} control is cut off (${c.left.toFixed(0)}..${c.right.toFixed(0)})`);
        assert.ok(got.statusRegions <= 1, `${label}: one status region at most, got ${got.statusRegions}`);
        if (view === 'list') {
          assert.ok(got.heads.includes('Code') && got.heads.includes('Question'), `${label}: the Code and Question columns must render`);
          assert.equal(await page.locator('tbody tr').count(), 5, `${label}: five rows`);
        }
        await page.screenshot({ path: `shots/questions-${view}-${width}-${scheme}.png`, fullPage: true });
        await page.close();
      }
    }
  }
  console.log('questions layout: ok');
} finally {
  await browser?.close();
  await server.close();
}
