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
const FINE_SELECT_H = 24; // px, #1605: px-3 py-1 text-xs, as on main
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
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, x, y, hit: b.contains(document.elementFromPoint(x, y)) };
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
            // #1606 item 2: the memory panel's own heading is visible: a
            // non-empty box inside the panel (jsdom can only prove it exists).
            memoryHeading: (() => {
              const h = memory.querySelector('h2');
              if (!h) return null;
              const r = h.getBoundingClientRect();
              return { text: h.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            })(),
            // #1604 item 1: what the rows actually render (innerText honours
            // display: none, so a column hidden at this width reads as empty).
            orgText: [...memory.querySelectorAll('tbody tr')].map((tr) => {
              const td = tr.querySelectorAll('td');
              // A display:none element's innerText falls back to its textContent,
              // so an unrendered cell is read as empty explicitly.
              return { name: td[0].innerText, org: td[2].getClientRects().length ? td[2].innerText.trim() : '' };
            }),
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
        // #1605: a coarse pointer gets the portal's 44px target (min-h-11);
        // a fine pointer keeps the dense 24px button, unchanged.
        if (coarse) assert.ok(got.select.height >= 44, `${label}: the row Select is ${got.select.height}px tall on a coarse pointer, under 44px`);
        else assert.ok(Math.abs(got.select.height - FINE_SELECT_H) < 0.5, `${label}: the row Select is ${got.select.height}px tall on a fine pointer, not the unchanged ${FINE_SELECT_H}px`);
        // #1600 item 3.
        assert.equal(got.coarse, coarse, `${label}: pointer emulation is not what this leg expects`);
        assert.equal(got.escHint, coarse ? 'hidden' : 'visible', `${label}: "Esc to close" should be ${coarse ? 'hidden on a coarse pointer' : 'visible on a fine pointer'}`);
        console.log(JSON.stringify({ width, height, view, scheme, pointer: coarse ? 'coarse' : 'fine', headerBottom: got.headerBottom, memoryTop: got.memoryTop, memoryBottom: got.memoryBottom, gutter: [got.memoryLeft, got.viewport.w - got.memoryRight], escHint: got.escHint }));
        if (process.env.STACKED_SHOTS) await page.screenshot({ path: `${process.env.STACKED_SHOTS}/stacked-${view}-${width}x${height}-${scheme}.png` });
        // #1606 item 2.
        assert.ok(got.memoryHeading, `${label}: the memory panel has no heading`);
        assert.equal(got.memoryHeading.text, 'Choose a memory', `${label}: memory panel heading text`);
        assert.ok(got.memoryHeading.width > 0 && got.memoryHeading.height > 0, `${label}: the memory panel heading has an empty box`);
        assert.ok(got.memoryHeading.left >= got.memoryLeft && got.memoryHeading.right <= got.memoryRight && got.memoryHeading.top >= got.memoryTop && got.memoryHeading.bottom <= got.memoryBottom,
          `${label}: the memory panel heading (${got.memoryHeading.left}..${got.memoryHeading.right}, ${got.memoryHeading.top}..${got.memoryHeading.bottom}) is outside the panel`);
        // #1604 item 1: the no-org row (m1, first) shows no stray dash under
        // its name at any width; at sm and up its own Organization cell keeps
        // the dash, unchanged. The org row (m2) shows its org either way.
        const noOrg = got.orgText[0], withOrg = got.orgText[1];
        assert.ok(!noOrg.name.includes('—'), `${label}: a no-org row shows a stray dash under the name: ${JSON.stringify(noOrg.name)}`);
        assert.equal(noOrg.org, width >= 640 ? '—' : '', `${label}: the no-org row's Organization column`);
        assert.ok(width >= 640 ? withOrg.org === 'Hadron Memory' : withOrg.name.includes('Hadron Memory'), `${label}: the org row's org name is not shown`);
        // #1604 item 2: on a coarse pointer the first row's truncated URN chip
        // is a toggle; a tap reveals the whole URN inside the panel, a second
        // tap truncates it again. A fine pointer keeps the plain chip.
        const chip = () => page.evaluate(() => {
          const memory = document.querySelector('[role="dialog"][aria-label="Choose a memory"]');
          const td = memory.querySelector('tbody tr').querySelectorAll('td')[1];
          const toggle = td.querySelector('button[aria-expanded]');
          const span = td.querySelector('span[title]');
          const r = (toggle ?? span).getBoundingClientRect();
          const s = span.getBoundingClientRect();
          return {
            toggle: !!toggle, expanded: toggle?.getAttribute('aria-expanded') ?? null,
            truncated: span.scrollWidth > span.clientWidth + 1,
            text: span.textContent, title: span.getAttribute('title'),
            x: r.left + r.width / 2, y: r.top + r.height / 2,
            right: s.right, memoryRight: memory.getBoundingClientRect().right,
          };
        });
        const before = await chip();
        if (coarse) {
          assert.equal(before.toggle, true, `${label}: the compact URN chip is not a reveal toggle on a coarse pointer`);
          assert.equal(before.expanded, 'false', `${label}: the URN chip should start collapsed`);
          assert.equal(before.truncated, true, `${label}: the fixture URN must be truncated here, or this leg proves nothing`);
          await page.touchscreen.tap(before.x, before.y);
          await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Choose a memory"] tbody tr button[aria-expanded="true"]'), null, { timeout: 5000 });
          const open = await chip();
          assert.equal(open.truncated, false, `${label}: tapping the URN chip did not reveal the whole URN`);
          assert.equal(open.text, open.title, `${label}: the revealed text is not the whole URN`);
          assert.ok(open.text.startsWith('hrn:mem:'), `${label}: the revealed URN is not fully qualified: ${open.text}`);
          assert.ok(open.right <= open.memoryRight, `${label}: the revealed URN runs out of the panel (${open.right} > ${open.memoryRight})`);
          if (process.env.STACKED_SHOTS) await page.screenshot({ path: `${process.env.STACKED_SHOTS}/stacked-${view}-${width}x${height}-${scheme}-urn-open.png` });
          await page.touchscreen.tap(open.x, open.y);
          await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Choose a memory"] tbody tr button[aria-expanded="false"]'), null, { timeout: 5000 });
          assert.equal((await chip()).truncated, true, `${label}: a second tap did not truncate the URN again`);
        } else {
          assert.equal(before.toggle, false, `${label}: a fine pointer must keep the plain URN chip`);
        }
        // #1600 items 2 and 6: one tap (a click on a fine pointer) on that
        // Select picks the memory: the memory panel closes and the node
        // dialog shows the chosen memory.
        if (coarse) await page.touchscreen.tap(got.select.x, got.select.y);
        else await page.mouse.click(got.select.x, got.select.y);
        // #1606 item 1: a bounded condition wait, not a fixed sleep.
        await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Choose a memory"]'), null, { timeout: 5000 })
          .catch(() => {}); // the assertion below reports it
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
