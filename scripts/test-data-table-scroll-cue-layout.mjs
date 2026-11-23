// portal#2503: the DataTable scroll cue in real Chromium with the compiled app.css, light and dark.
// jsdom paints nothing, so two things only a browser can answer live here:
//  - item 7: at phone width a pinned end column (an opaque sticky cell on the scroller's right edge) must
//    not swallow the end cue. The cue has to end exactly at the scroll/pin boundary, and be shown.
//  - item 6: the cue is a shade, not a glow: in dark mode its gradient is not white (it comes from palette tokens).
// Synthetic data only. Setup: pnpm exec playwright install chromium. Run: pnpm test:data-table-scroll-cue-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 500)))));
// The first colour in a computed gradient, as { a, lum } on a 0..1 scale (relative luminance of the sRGB channels).
function firstStop(image) {
  const srgb = image.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  const rgb = image.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  const hit = srgb ? { c: [1, 2, 3].map((i) => Number(srgb[i])), a: srgb[4] } : rgb ? { c: [1, 2, 3].map((i) => Number(rgb[i]) / 255), a: rgb[4] } : null;
  if (!hit) return null;
  const [r, g, b] = hit.c;
  return { a: hit.a === undefined ? 1 : Number(hit.a), lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}
const measure = (page, dark) => page.evaluate((dark) => {
  const scroller = document.querySelector('[data-testid="data-table-scroller"]');
  const cue = document.querySelector('[data-testid="data-table-scroll-cue-end"]');
  const pin = scroller.querySelector('tbody td:last-child');
  const c = cue.getBoundingClientRect(), p = pin.getBoundingClientRect(), s = scroller.getBoundingClientRect();
  const cs = getComputedStyle(cue);
  return {
    cue: { left: c.left, right: c.right, width: c.width }, pin: { left: p.left, right: p.right, width: p.width }, scroller: { right: s.right },
    token: getComputedStyle(document.documentElement).getPropertyValue(dark ? '--color-zinc-950' : '--color-zinc-900').trim(),
    opacity: Number(cs.opacity), image: cs.backgroundImage, overflowEnd: scroller.hasAttribute('data-overflow-end'), pinSticky: getComputedStyle(pin).position === 'sticky',
  };
}, dark);

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
const failures = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const dark of [false, true]) {
    for (const pinned of [true, false]) {
      const label = `390x844 ${dark ? 'dark' : 'light'} ${pinned ? 'pinned end column' : 'no pin (control)'}`;
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route('**/__cue_fixture*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>cue</title>' }));
      await page.goto(new URL('/__cue_fixture', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="app" class="p-4"></main>`;
        document.documentElement.classList.toggle('dark', dark);
        document.body.className = 'bg-white dark:bg-zinc-950';
      }, { css, dark });
      await page.evaluate(async (props) => { const m = await import('/src/lib/test/fixtures/data-table-cue-harness.ts'); m.mountCue(document.getElementById('app'), props); }, pinned ? { stickyEndColumn: 'second' } : {});
      await page.locator('[data-testid="data-table-scroller"] tbody td').first().waitFor();
      await frames(page);
      const m = await measure(page, dark);
      if (!m.overflowEnd) failures.push(`${label}: the fixture must overflow with the end edge marked ${JSON.stringify(m)}`);
      if (m.opacity !== 1) failures.push(`${label}: the end cue is not shown (opacity ${m.opacity})`);
      if (pinned) {
        if (!m.pinSticky) failures.push(`${label}: the end column is not pinned on the phone, the fixture proves nothing`);
        // The pin is opaque and paints over the cue's old spot at the scroller edge: the cue must end where the pin begins.
        if (Math.abs(m.cue.right - m.pin.left) > 1.5) failures.push(`${label}: the end cue must end at the pinned column's left edge (cue right ${m.cue.right}, pin left ${m.pin.left})`);
      } else if (Math.abs(m.cue.right - (m.scroller.right - 1)) > 1.5) failures.push(`${label}: with no pin the end cue stays on the scroller edge ${JSON.stringify(m)}`);
      // The colour comes from the palette: the zinc token the cue names is really emitted (else the #hex fallback would stand in silently).
      if (!m.token) failures.push(`${label}: the palette token the cue uses (--color-zinc-${dark ? '950' : '900'}) is not defined, so the fallback colour is in use`);
      // A shade, not a glow: parse the gradient's first colour stop and judge it numerically, whatever syntax the engine
      // serialises it in (rgb(), rgba() or color(srgb ...)). It must paint (alpha > 0) and be dark (not a white wash).
      const stop = firstStop(m.image);
      if (!stop) failures.push(`${label}: could not read the cue gradient's first colour ${m.image}`);
      else {
        if (!(stop.a > 0.05)) failures.push(`${label}: the cue paints nothing (alpha ${stop.a}) ${m.image}`);
        if (!(stop.lum < 0.25)) failures.push(`${label}: the cue is a light wash (luminance ${stop.lum.toFixed(2)}), not a shade ${m.image}`);
      }
      if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/scroll-cue-${dark ? 'dark' : 'light'}-${pinned ? 'pinned' : 'plain'}.png` });
      console.log(JSON.stringify({ label, cueRight: m.cue.right, pinLeft: m.pin.left, image: m.image.slice(0, 90) }));
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
assert.deepEqual(failures, [], failures.join('\n'));
console.log('scroll cue layout ok');
