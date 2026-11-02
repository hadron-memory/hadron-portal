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
const GUTTER = 8; // px, #1600 item 2
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
        // Phone widths run as a touch device (pointer: coarse); hasTouch alone
        // keeps the real layout width, where isMobile would lay out at 980px.
        const coarse = width <= 390;
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: coarse });
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
          // What lies on top at the Close button's centre must not be the
          // stacked memory PANEL. (Its transparent full-screen backdrop is
          // above everything by design: a click there closes the memory
          // picker, the modal contract. The defect is the panel itself
          // painting over the host's header.)
          const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
          return {
            headerBottom: Math.max(c.bottom, h.bottom),
            memoryTop: m.top, memoryBottom: m.bottom, memoryLeft: m.left, memoryRight: m.right,
            closeVisible: !memory.contains(hit),
            viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
            // The memory picker's own rows must still be usable, not squeezed out.
            memoryRows: memory.querySelectorAll('tbody tr').length,
            // #1600 items 2 and 6: every column header and the first row's
            // Select are fully inside the panel (and so the viewport), and
            // the Select is what a tap at its centre actually hits.
            headers: [...memory.querySelectorAll('thead th')].map((th) => {
              const r = th.getBoundingClientRect();
              return { text: th.textContent.trim(), left: r.left, right: r.right, width: r.width };
            }),
            select: (() => {
              const b = [...memory.querySelectorAll('tbody tr button')].find((x) => x.textContent?.trim() === 'Select');
              if (!b) return null;
              const r = b.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, x, y, hit: b.contains(document.elementFromPoint(x, y)) };
            })(),
            // #1600 item 3: "Esc to close" is keyboard help, so a coarse
            // (touch) pointer doesn't render it.
            escHint: (() => {
              const el = [...memory.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent?.trim() === 'Esc to close');
              if (!el) return 'absent';
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? 'visible' : 'hidden';
            })(),
            coarse: matchMedia('(pointer: coarse)').matches,
          };
        });
        const got = await measure();
        assert.ok(!got.missing, `${label}: both dialogs must be open, got ${JSON.stringify(got.missing)}`);
        assert.ok(got.memoryTop >= got.headerBottom, `${label}: the memory dialog (top ${got.memoryTop}) covers the node dialog's header (bottom ${got.headerBottom})`);
        assert.equal(got.closeVisible, true, `${label}: the memory panel paints over the node dialog's Close`);
        assert.ok(got.memoryBottom <= got.viewport.h, `${label}: the memory dialog runs off the bottom (${got.memoryBottom} > ${got.viewport.h})`);
        assert.ok(got.memoryLeft >= 0 && got.memoryRight <= got.viewport.w, `${label}: the memory dialog runs off the side`);
        assert.ok(got.memoryRows >= 1, `${label}: the memory list must still show rows`);
        // #1600 item 2: a side gutter, not edge to edge.
        assert.ok(got.memoryLeft >= GUTTER && got.memoryRight <= got.viewport.w - GUTTER, `${label}: the memory panel needs a ${GUTTER}px side gutter (left ${got.memoryLeft}, right ${got.memoryRight} of ${got.viewport.w})`);
        for (const h of got.headers) {
          if (h.width === 0) continue; // a column not rendered at this width (display: none)
          assert.ok(h.left >= got.memoryLeft && h.right <= got.memoryRight, `${label}: column header "${h.text}" (${h.left}..${h.right}) is outside the memory panel (${got.memoryLeft}..${got.memoryRight})`);
        }
        assert.ok(got.select, `${label}: no Select button in the first rows`);
        assert.ok(got.select.left >= got.memoryLeft && got.select.right <= got.memoryRight && got.select.bottom <= got.memoryBottom && got.select.top >= got.memoryTop,
          `${label}: the first row's Select (${got.select.left}..${got.select.right}) is outside the memory panel (${got.memoryLeft}..${got.memoryRight})`);
        assert.equal(got.select.hit, true, `${label}: a tap at the first row's Select centre does not hit it`);
        // #1600 item 3.
        assert.equal(got.coarse, coarse, `${label}: pointer emulation is not what this leg expects`);
        assert.equal(got.escHint, coarse ? 'hidden' : 'visible', `${label}: "Esc to close" should be ${coarse ? 'hidden on a coarse pointer' : 'visible on a fine pointer'}`);
        console.log(JSON.stringify({ width, height, view, scheme, pointer: coarse ? 'coarse' : 'fine', headerBottom: got.headerBottom, memoryTop: got.memoryTop, memoryBottom: got.memoryBottom, gutter: [got.memoryLeft, got.viewport.w - got.memoryRight], escHint: got.escHint }));
        if (process.env.STACKED_SHOTS) await page.screenshot({ path: `${process.env.STACKED_SHOTS}/stacked-${view}-${width}x${height}-${scheme}.png` });
        // #1600 items 2 and 6: one tap (a click on a fine pointer) on that
        // Select picks the memory: the memory panel closes and the node
        // dialog shows the chosen memory.
        if (coarse) await page.touchscreen.tap(got.select.x, got.select.y);
        else await page.mouse.click(got.select.x, got.select.y);
        await page.waitForTimeout(50);
        const after = await page.evaluate(() => ({
          memoryOpen: !!document.querySelector('[role="dialog"][aria-label="Choose a memory"]'),
          nodeText: document.querySelector('[role="dialog"][aria-label="Choose a node"]')?.textContent ?? '',
        }));
        assert.equal(after.memoryOpen, false, `${label}: tapping Select did not close the memory panel`);
        assert.ok(after.nodeText.includes('Product Team with a fairly long memory name'), `${label}: tapping Select did not pick the memory`);
        await page.close();
      }
    }
  }
  // A resize while stacked: small to large moves the host header DOWN (its
  // top padding is 8vh), so a measurement taken once at open goes stale and
  // the memory panel would sit over the header again.
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
    await mountView(page, origin, css, 'stacked');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(50);
    const got = await page.evaluate(() => {
      const node = document.querySelector('[role="dialog"][aria-label="Choose a node"]');
      const memory = document.querySelector('[role="dialog"][aria-label="Choose a memory"]');
      const close = [...node.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close');
      return { headerBottom: Math.max(close.getBoundingClientRect().bottom, node.querySelector('h2').getBoundingClientRect().bottom), memoryTop: memory.getBoundingClientRect().top };
    });
    assert.ok(got.memoryTop >= got.headerBottom, `resize 375x667 -> 1440x900: the memory dialog (top ${got.memoryTop}) covers the header (bottom ${got.headerBottom})`);
    console.log(JSON.stringify({ resize: '375x667->1440x900', ...got }));
    await page.close();
  }
  console.log('stacked memory picker: clear of the node dialog header at every viewport, light and dark');
} finally {
  await browser?.close();
  await server.close();
}
