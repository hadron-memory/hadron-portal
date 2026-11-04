// portal#1619 (first slice): the Task integrations heading receives focus after a keyboard Cancel,
// and must paint a visible ring. Tailwind 4 computes `outline-style: none` when `outline-none` /
// `focus:outline-none` sits beside `focus-visible:outline-2`, so the ring was never drawn. jsdom has
// no Tailwind cascade, so this is real Chromium with the compiled app.css and the real component.
// Same cause as #1675 (ApplyAgentTickers), which keeps its own slice.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-integrations-focus
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// portal#1151: Vite may re-optimise dependencies on first import and reload the page; start again.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountSection(page, origin, css) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>focus</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: '#col { max-width: 640px; margin: 24px 16px; }' });
      await page.evaluate(async () => {
        const { mountTaskIntegrations } = await import('/src/lib/test/fixtures/task-integrations-harness.ts');
        mountTaskIntegrations(document.getElementById('col'));
      });
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const ring = (page) => page.evaluate(() => {
  const h = document.getElementById('task-integrations-heading');
  const cs = getComputedStyle(h);
  return {
    focused: document.activeElement === h,
    focusVisible: h.matches(':focus-visible'),
    style: cs.outlineStyle,
    width: parseFloat(cs.outlineWidth),
    color: cs.outlineColor,
  };
});

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  for (const width of [390, 1280]) {
    for (const scheme of ['light', 'dark']) {
      const label = `${width}px ${scheme}`;
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await mountSection(page, origin, css);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
      }, scheme === 'dark');
      await page.waitForSelector('#task-integrations-heading');

      // Keyboard: Edit, then Cancel, both by the keyboard. Focus returns to the heading.
      await page.focus('button:has-text("Edit")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('button:has-text("Cancel")');
      await page.focus('button:has-text("Cancel")');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement?.id === 'task-integrations-heading');
      const kb = await ring(page);
      // Evidence for the UX seat: FOCUS_SHOTS=<dir> saves the rendered state before asserting.
      if (process.env.FOCUS_SHOTS) await page.screenshot({ path: `${process.env.FOCUS_SHOTS}/${width}-${scheme}.png`, clip: { x: 0, y: 0, width, height: 140 } });
      assert.ok(kb.focused && kb.focusVisible, `${label}: heading must be focused and match :focus-visible after keyboard Cancel (${JSON.stringify(kb)})`);
      assert.notEqual(kb.style, 'none', `${label}: keyboard focus ring is not painted, outline-style is none (${JSON.stringify(kb)})`);
      assert.ok(kb.width >= 2, `${label}: ring is narrower than 2px (${JSON.stringify(kb)})`);
      // Not clipped: the heading's own outline must sit inside the viewport.
      const box = await page.evaluate(() => { const r = document.getElementById('task-integrations-heading').getBoundingClientRect(); return { left: r.left, top: r.top }; });
      assert.ok(box.left - 4 >= 0 && box.top - 4 >= 0, `${label}: ring would be clipped by the viewport (${JSON.stringify(box)})`);

      // Pointer: a click that focuses the heading keeps its old behaviour, no ring.
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.click(1, 1);
      await page.click('#task-integrations-heading');
      const ptr = await ring(page);
      assert.ok(ptr.focused && !ptr.focusVisible, `${label}: a pointer focus must not match :focus-visible (${JSON.stringify(ptr)})`);
      assert.equal(ptr.style, 'none', `${label}: pointer focus must not paint a ring (${JSON.stringify(ptr)})`);
      await page.close();
      console.log(`ok ${label}: keyboard ring ${kb.style} ${kb.width}px ${kb.color}; pointer none`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
