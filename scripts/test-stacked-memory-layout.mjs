// portal#1590: with SelectNode open and its memory picker (SelectMemory)
// stacked above it, the upper dialog must not cover the node dialog's header,
// so its title and Close stay visible. jsdom has no layout engine, so this is
// real Chromium: the real components mounted through Vite with the compiled
// app.css (the test-select-node-layout harness), measured at each viewport.
//
// Two stacked states: the auto-open memory stage (no memory chosen yet) and
// Change… after a memory is chosen (the state QA found on #1587).
// Viewports: 375x667, 390x844, 768x1024, 1280x720, 1440x900, light and dark.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:stacked-memory-layout   (STACKED_SHOTS=dir for screenshots)
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const RELOADED = /Execution context was destroyed|navigation/i;

async function mountView(page, origin, css, view) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.evaluate(async (view) => {
        const { mountSelectNode } = await import('/src/lib/test/fixtures/select-node-harness.ts');
        await mountSelectNode(document.getElementById('col'), view);
      }, view);
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const viewports = [[375, 667], [390, 844], [768, 1024], [1280, 720], [1440, 900]];
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of viewports) {
    for (const view of ['memory-stage', 'stacked']) {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height } });
        await mountView(page, origin, css, view);
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');
        const label = `${view} (${scheme}) at ${width}x${height}`;
        const measure = () => page.evaluate(() => {
          const node = document.querySelector('[role="dialog"][aria-label="Choose a node"]');
          const memory = document.querySelector('[role="dialog"][aria-label="Choose a memory"]');
          if (!node || !memory) return { missing: { node: !!node, memory: !!memory } };
          const close = [...node.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close');
          const title = node.querySelector('h2');
          const c = close.getBoundingClientRect();
          const h = title.getBoundingClientRect();
          const m = memory.getBoundingClientRect();
          // What a pointer at the Close button's centre actually hits: the
          // control itself, not the stacked dialog lying over it.
          const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
          return {
            headerBottom: Math.max(c.bottom, h.bottom),
            memoryTop: m.top, memoryBottom: m.bottom, memoryLeft: m.left, memoryRight: m.right,
            closeHit: close === hit || close.contains(hit),
            viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
            // The memory picker's own rows must still be usable, not squeezed out.
            memoryRows: memory.querySelectorAll('tbody tr').length,
          };
        });
        const got = await measure();
        assert.ok(!got.missing, `${label}: both dialogs must be open, got ${JSON.stringify(got.missing)}`);
        assert.ok(got.memoryTop >= got.headerBottom, `${label}: the memory dialog (top ${got.memoryTop}) covers the node dialog's header (bottom ${got.headerBottom})`);
        assert.equal(got.closeHit, true, `${label}: the node dialog's Close is covered`);
        assert.ok(got.memoryBottom <= got.viewport.h, `${label}: the memory dialog runs off the bottom (${got.memoryBottom} > ${got.viewport.h})`);
        assert.ok(got.memoryLeft >= 0 && got.memoryRight <= got.viewport.w, `${label}: the memory dialog runs off the side`);
        assert.ok(got.memoryRows >= 1, `${label}: the memory list must still show rows`);
        console.log(JSON.stringify({ width, height, view, scheme, headerBottom: got.headerBottom, memoryTop: got.memoryTop, memoryBottom: got.memoryBottom }));
        if (process.env.STACKED_SHOTS) await page.screenshot({ path: `${process.env.STACKED_SHOTS}/stacked-${view}-${width}x${height}-${scheme}.png` });
        await page.close();
      }
    }
  }
  console.log('stacked memory picker: clear of the node dialog header at every viewport, light and dark');
} finally {
  await browser?.close();
  await server.close();
}
