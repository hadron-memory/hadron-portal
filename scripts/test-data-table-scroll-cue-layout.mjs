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
// The strongest colour stop of a computed gradient (the one with the highest alpha, so it does not matter which way the
// gradient runs or that its far end is transparent), in any serialisation (rgb, rgba or color(srgb)).
// Returns { a, luma, c } with c = [r, g, b] on 0..1. `luma` is the gamma-encoded Rec.709 weighting, a darkness gauge, not linear luminance.
function strongestStop(image) {
  const stops = [];
  for (const m of image.matchAll(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)|rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/g)) {
    const c = m[1] !== undefined ? [m[1], m[2], m[3]].map(Number) : [m[5], m[6], m[7]].map((v) => Number(v) / 255);
    const a = Number(m[1] !== undefined ? (m[4] ?? 1) : (m[8] ?? 1));
    stops.push({ a, c, luma: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] });
  }
  return stops.sort((x, y) => y.a - x.a)[0] ?? null;
}
const measure = (page, dark) => page.evaluate((dark) => {
  const scroller = document.querySelector('[data-testid="data-table-scroller"]');
  const cue = document.querySelector('[data-testid="data-table-scroll-cue-end"]');
  const pin = scroller.querySelector('tbody td:last-child');
  const c = cue.getBoundingClientRect(), p = pin.getBoundingClientRect(), s = scroller.getBoundingClientRect();
  const cs = getComputedStyle(cue);
  return {
    cue: { left: c.left, right: c.right, width: c.width }, pin: { left: p.left, right: p.right, width: p.width }, scroller: { left: s.left, right: s.right },
    token: getComputedStyle(document.documentElement).getPropertyValue(dark ? '--color-zinc-950' : '--color-zinc-900').trim(),
    headerBg: getComputedStyle(scroller.querySelector('thead th')).backgroundColor,
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
      if (!(m.cue.width > 0) || m.cue.left < m.scroller.left - 1) failures.push(`${label}: the end cue has no width or starts outside the scroller ${JSON.stringify(m.cue)}`);
      if (m.opacity !== 1) failures.push(`${label}: the end cue is not shown (opacity ${m.opacity})`);
      if (pinned) {
        if (!m.pinSticky) failures.push(`${label}: the end column is not pinned on the phone, the fixture proves nothing`);
        // The pin is opaque and paints over the cue's old spot at the scroller edge: the cue must end where the pin begins.
        if (Math.abs(m.cue.right - m.pin.left) > 1.5) failures.push(`${label}: the end cue must end at the pinned column's left edge (cue right ${m.cue.right}, pin left ${m.pin.left})`);
      } else if (Math.abs(m.cue.right - (m.scroller.right - 1)) > 1.5) failures.push(`${label}: with no pin the end cue stays on the scroller edge ${JSON.stringify(m)}`);
      // The colour comes from the palette: the zinc token the cue names is really emitted (else the #hex fallback would stand in silently).
      if (!m.token) failures.push(`${label}: the palette token the cue uses (--color-zinc-${dark ? '950' : '900'}) is not defined, so the fallback colour is in use`);
      // A shade, not a glow: judge the strongest colour stop numerically. It must paint (alpha > 0.05) and be dark (luma < 0.25).
      const stop = strongestStop(m.image);
      if (!stop) failures.push(`${label}: could not read a colour from the cue gradient ${m.image}`);
      else {
        if (!(stop.a > 0.05)) failures.push(`${label}: the cue paints nothing (alpha ${stop.a}) ${m.image}`);
        if (!(stop.luma < 0.25)) failures.push(`${label}: the cue is a light wash (luma ${stop.luma.toFixed(2)}), not a shade ${m.image}`);
        // Visible against a real surface: composite the strongest stop over the table header (a different surface from the page in both
        // themes) and require a perceptible change of at least 3/255 on some channel. Over a row of the page's own colour a shade
        // can only dim what scrolls under it; the header is where its own contrast is measurable.
        const bg = m.headerBg.match(/[\d.]+/g)?.slice(0, 3).map((v) => Number(v) / 255);
        if (!bg || bg.length < 3) failures.push(`${label}: could not read the header background ${m.headerBg}`);
        else {
          const delta = Math.max(...bg.map((v, i) => Math.abs(stop.a * stop.c[i] + (1 - stop.a) * v - v))) * 255;
          if (delta < 3) failures.push(`${label}: the cue is invisible over the table header (change ${delta.toFixed(1)}/255 on ${m.headerBg})`);
        }
      }
      if (process.env.CELL_SHOTS) await page.screenshot({ path: `${process.env.CELL_SHOTS}/scroll-cue-${dark ? 'dark' : 'light'}-${pinned ? 'pinned' : 'plain'}.png` });
      console.log(JSON.stringify({ label, cueRight: m.cue.right, pinLeft: m.pin.left, image: m.image.slice(0, 90) }));
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
assert.deepEqual(failures, [], failures.join('\n'));
console.log('scroll cue layout ok');
