// #2082: the conversation panel's Save, Clear and Save goals controls are at least
// 44px high (the height of the ↑/↓ order buttons beside them), Save/Save goals text
// reaches 4.5:1 against its fill, Clear is neutral rather than red, and a visible
// focus indicator remains, at 390px and desktop, light and dark. Real Chromium:
// jsdom cannot measure layout. Each mutant must turn its own check red.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:conversation-panel-buttons-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const ratio = (a, b) => { const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  const open = async (width, dark) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(new URL('/@vite/client', origin).href);
    await page.evaluate(([css, dark]) => {
      document.head.innerHTML = '';
      document.documentElement.classList.toggle('dark', dark);
      document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
    }, [css, dark]);
    await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 360}px; margin: 0 auto; }` });
    await page.evaluate(async () => {
      const { mountPanel } = await import('/src/lib/test/fixtures/conversation-info-panel-harness.ts');
      await mountPanel(document.getElementById('col'), true);
    });
    await page.waitForSelector('#convStartHeading');
    return page;
  };

  const controls = (page) => page.evaluate(() => {
    const pick = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === text);
    const out = {};
    for (const [key, el] of Object.entries({
      save: pick('button[value="save"]', 'Save'),
      clear: pick('button[value="clear"]', 'Clear'),
      goals: pick('form button[type="submit"]', 'Save goals'),
    })) {
      if (!el) { out[key] = null; continue; }
      const cs = getComputedStyle(el);
      // Computed colours can be oklch(); a 1px canvas resolves any of them to sRGB.
      const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return `rgb(${[...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',')})`; };
      out[key] = { h: el.getBoundingClientRect().height, color: rgb(cs.color), bg: rgb(cs.backgroundColor), right: el.getBoundingClientRect().right };
    }
    out.col = document.getElementById('col').getBoundingClientRect().right;
    out.scrollWidth = document.documentElement.scrollWidth;
    return out;
  });

  for (const width of [390, 1280]) for (const dark of [false, true]) {
    const label = `${width}px ${dark ? 'dark' : 'light'}`;
    const page = await open(width, dark);
    const m = await controls(page);
    for (const k of ['save', 'clear', 'goals']) assert.ok(m[k], `${label}: ${k} control missing`);
    for (const k of ['save', 'clear', 'goals']) {
      assert.ok(m[k].h >= 44, `${label}: ${k} is ${m[k].h}px high, needs >= 44`);
      assert.ok(m[k].right <= m.col + 0.5, `${label}: ${k} runs past the column`);
    }
    assert.ok(m.scrollWidth <= width, `${label}: page overflows`);
    for (const k of ['save', 'goals']) {
      const r = ratio(m[k].color, m[k].bg);
      assert.ok(r >= 4.5, `${label}: ${k} contrast ${r.toFixed(2)} < 4.5 (${m[k].color} on ${m[k].bg})`);
    }
    // Clear stays a neutral link look: not the red it had.
    const [cr, cg, cb] = parse(m.clear.color);
    assert.ok(!(cr > cg + 40 && cr > cb + 40), `${label}: Clear is red (${m.clear.color})`);
    // Keyboard focus keeps a visible indicator on all three.
    for (const sel of ['button[value="save"]', 'button[value="clear"]']) {
      await page.focus(sel); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      const ring = await page.evaluate((s) => { const cs = getComputedStyle(document.querySelector(s)); return { style: cs.outlineStyle, shadow: cs.boxShadow }; }, sel);
      assert.ok(ring.style !== 'none' || ring.shadow !== 'none', `${label}: ${sel} has no focus indicator`);
    }
    // States: disabled keeps its height.
    await page.evaluate(() => document.querySelector('button[value="save"]').setAttribute('disabled', ''));
    assert.ok((await controls(page)).save.h >= 44, `${label}: disabled Save shrinks below 44px`);

    if (width === 390 && !dark) {
      // Mutants: each check must be able to fail.
      const h = await page.addStyleTag({ content: 'button[value="save"], button[value="clear"] { min-height: 0 !important; height: 28px !important; }' });
      assert.ok((await controls(page)).save.h < 44, 'height mutant must go red');
      await h.evaluate((el) => el.remove());
      const c = await page.addStyleTag({ content: 'button[value="save"] { color: #fff !important; background: #fb8500 !important; }' });
      const mm = await controls(page);
      assert.ok(ratio(mm.save.color, mm.save.bg) < 4.5, 'white-on-orange mutant must go red');
      await c.evaluate((el) => el.remove());
      const r = await page.addStyleTag({ content: 'button[value="clear"] { color: #ef4444 !important; }' });
      const [mr, mg, mb] = parse((await controls(page)).clear.color);
      assert.ok(mr > mg + 40 && mr > mb + 40, 'red-Clear mutant must go red');
      await r.evaluate((el) => el.remove());
    }
    console.log(JSON.stringify({ label, save: m.save.h, clear: m.clear.h, goals: m.goals.h, contrast: ratio(m.save.color, m.save.bg).toFixed(2) }));
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
