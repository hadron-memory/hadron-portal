// portal#1675: the ApplyAgentTickers result region receives focus after a keyboard apply,
// and must paint a visible ring. Tailwind 4 computes `outline-style: none` when `outline-none`
// sits beside `focus-visible:outline-2`, so the ring was never drawn; the fix scopes the
// suppression to `:focus` and re-states `focus-visible:outline-solid` (same as #1619).
// jsdom has no Tailwind cascade, so this is real Chromium with the compiled app.css and the
// real component.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:apply-agent-tickers-focus
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
        const { mountApplyAgentTickers } = await import('/src/lib/test/fixtures/apply-agent-tickers-harness.ts');
        mountApplyAgentTickers(document.getElementById('col'));
      });
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const ring = (page) => page.evaluate(() => {
  const r = document.getElementById('apply-tickers-result');
  const cs = getComputedStyle(r);
  return {
    focused: document.activeElement === r,
    focusVisible: r.matches(':focus-visible'),
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
      await page.waitForSelector('#apply-tickers-result');

      // Keyboard: the apply button is reached and pressed by the keyboard (the real flow is Enter on
      // "Apply the Agent's tickers", whose settleFocus calls region.focus() while the document is in
      // keyboard modality). A real Tab establishes the modality; the region takes focus exactly as
      // settleFocus gives it. The form is never submitted — the pin is about the ring, not the POST.
      await page.keyboard.press('Tab'); // button -> keyboard modality is on
      await page.waitForFunction(() => document.activeElement?.tagName === 'BUTTON');
      await page.evaluate(() => document.getElementById('apply-tickers-result').focus());
      await page.waitForFunction(() => document.activeElement?.id === 'apply-tickers-result');
      const kb = await ring(page);
      // Evidence for the UX seat: FOCUS_SHOTS=<dir> saves the rendered state before asserting.
      if (process.env.FOCUS_SHOTS) await page.screenshot({ path: `${process.env.FOCUS_SHOTS}/${width}-${scheme}.png`, clip: { x: 0, y: 0, width, height: 240 } });
      assert.ok(kb.focused && kb.focusVisible, `${label}: region must be focused and match :focus-visible after a keyboard apply (${JSON.stringify(kb)})`);
      assert.notEqual(kb.style, 'none', `${label}: keyboard focus ring is not painted, outline-style is none (${JSON.stringify(kb)})`);
      assert.ok(kb.width >= 2, `${label}: ring is narrower than 2px (${JSON.stringify(kb)})`);
      // Not clipped: the region's own outline must sit inside the viewport.
      const box = await page.evaluate(() => { const r = document.getElementById('apply-tickers-result').getBoundingClientRect(); return { left: r.left, top: r.top }; });
      assert.ok(box.left - 4 >= 0 && box.top - 4 >= 0, `${label}: ring would be clipped by the viewport (${JSON.stringify(box)})`);

      // Pointer: a click that focuses the region keeps its old behaviour, no ring.
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.click(1, 1);
      await page.click('#apply-tickers-result');
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
