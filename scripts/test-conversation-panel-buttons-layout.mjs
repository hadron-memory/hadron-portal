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

  const open = async (width, dark, withCondition = true) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(new URL('/@vite/client', origin).href);
    await page.evaluate((css) => {
      document.head.innerHTML = '';
      document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
    }, css);
    await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 360}px; margin: 0 auto; }` });
    await page.evaluate(async (withCondition) => {
      const { mountPanel } = await import('/src/lib/test/fixtures/conversation-info-panel-harness.ts');
      await mountPanel(document.getElementById('col'), withCondition);
    }, withCondition);
    await page.waitForSelector('#convStartHeading');
    // Importing the app's modules can toggle <html class="dark"> on its own, so the
    // theme is applied after the mount and the real root state asserted (#2082 F2).
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), dark, `${width}px ${dark ? 'dark' : 'light'}: root theme not applied`);
    return page;
  };

  const controls = (page) => page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const out = {};
    for (const [key, el] of Object.entries({
      save: q('button[value="save"]'),
      clear: q('button[value="clear"]'),
      goals: q('form[action="?/updateGoals"] button[type="submit"]'),
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
    // Keyboard focus: a real :focus-visible match and a positive-width visible outline
    // on all three controls (#2082 F1).
    const SEL = { save: 'button[value="save"]', clear: 'button[value="clear"]', goals: 'form[action="?/updateGoals"] button[type="submit"]' };
    const ring = async (sel) => {
      await page.keyboard.press('Shift'); // keyboard modality, so focus() is focus-visible
      await page.focus(sel);
      return page.evaluate((s) => { const el = document.querySelector(s); const cs = getComputedStyle(el); // The ring colour as sRGB + alpha (a 1px canvas resolves oklch), and the nearest
        // opaque ancestor background it is drawn against (#2082 LOCAL delta F1).
        const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
        const px = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
        let bgEl = el.parentElement; let bg = [255, 255, 255, 255];
        for (; bgEl; bgEl = bgEl.parentElement) { const c = px(getComputedStyle(bgEl).backgroundColor); if (c[3] === 255) { bg = c; break; } }
        const ringPx = px(cs.outlineColor);
        return { fv: el.matches(':focus-visible'), active: document.activeElement === el, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: `rgb(${ringPx.slice(0, 3).join(',')})`, alpha: ringPx[3] / 255, bg: `rgb(${bg.slice(0, 3).join(',')})` }; }, sel);
    };
    for (const k of ['save', 'clear', 'goals']) {
      const r = await ring(SEL[k]);
      assert.ok(r.active && r.fv, `${label}: ${k} did not take keyboard focus (${JSON.stringify(r)})`);
      assert.ok(r.style !== 'none' && r.width >= 2, `${label}: ${k} focus ring is not visible (${JSON.stringify(r)})`);
      assert.ok(r.alpha === 1, `${label}: ${k} focus ring is not opaque (${JSON.stringify(r)})`);
      assert.ok(ratio(r.color, r.bg) >= 3, `${label}: ${k} focus ring contrast ${ratio(r.color, r.bg).toFixed(2)} < 3 against its background (${JSON.stringify(r)})`);
    }
    // Hover keeps size, contrast and (for Clear) neutrality.
    for (const k of ['save', 'clear', 'goals']) {
      await page.hover(SEL[k]);
      const hm = await controls(page);
      assert.ok(hm[k].h >= 44, `${label}: hovered ${k} is ${hm[k].h}px`);
      if (k !== 'clear') assert.ok(ratio(hm[k].color, hm[k].bg) >= 4.5, `${label}: hovered ${k} contrast`);
    }
    await page.mouse.move(0, 0);
    // Real "Saving..." state: hold the POST so the enhance handler stays submitting,
    // then measure the disabled controls (disabled keeps its 44px target).
    for (const [k, action, text] of [['save', 'updateEntryCondition', 'Saving...'], ['goals', 'updateGoals', 'Saving...']]) {
      let release;
      const held = new Promise((r) => (release = r));
      await page.route(`**/*?/${action}*`, async (route) => { await held; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'failure', status: 400, data: '[]' }) }).catch(() => {}); });
      await page.click(SEL[k]);
      await page.waitForFunction(([s, t]) => document.querySelector(s)?.textContent.trim() === t, [SEL[k], text]);
      const sm = await controls(page);
      assert.ok(await page.evaluate((s) => document.querySelector(s).disabled, SEL[k]), `${label}: ${k} is not disabled while saving`);
      assert.ok(sm[k].h >= 44, `${label}: saving ${k} is ${sm[k].h}px`);
      if (k === 'save') assert.ok(sm.clear.h >= 44, `${label}: disabled Clear is ${sm.clear.h}px`);
      release();
      await page.unroute(`**/*?/${action}*`);
    }
    // Clear is absent without a stored condition; Save keeps its size.
    const bare = await open(width, dark, false);
    const bm = await controls(bare);
    assert.equal(bm.clear, null, `${label}: Clear shown without a stored condition`);
    assert.ok(bm.save.h >= 44 && bm.goals.h >= 44, `${label}: Save/Save goals too short without Clear`);
    await bare.close();
    if (width === 390 && !dark) {
      const mp = await open(width, dark);
      const nf = await mp.addStyleTag({ content: 'button[value="save"], button[value="clear"], form[action="?/updateGoals"] button[type="submit"] { outline: 0 !important; }' });
      const nr = await mp.evaluate(() => { document.querySelector('button[value="save"]').focus(); return parseFloat(getComputedStyle(document.activeElement).outlineWidth); });
      assert.ok(nr < 2, 'no-focus-ring mutant must go red');
      const tm = await mp.addStyleTag({ content: 'button[value="save"] { outline: 2px solid transparent !important; }' });
      const ta = await mp.evaluate(() => { document.querySelector('button[value="save"]').focus(); const c = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }); c.fillStyle = getComputedStyle(document.activeElement).outlineColor; c.fillRect(0, 0, 1, 1); return c.getImageData(0, 0, 1, 1).data[3]; });
      assert.ok(ta < 255, 'transparent-outline mutant must go red');
      await tm.evaluate((el) => el.remove());
      await nf.evaluate((el) => el.remove());
      // Mutants: each check must be able to fail.
      const h = await mp.addStyleTag({ content: 'button[value="save"], button[value="clear"] { min-height: 0 !important; height: 28px !important; }' });
      assert.ok((await controls(mp)).save.h < 44, 'height mutant must go red');
      await h.evaluate((el) => el.remove());
      const c = await mp.addStyleTag({ content: 'button[value="save"] { color: #fff !important; background: #fb8500 !important; }' });
      const mm = await controls(mp);
      assert.ok(ratio(mm.save.color, mm.save.bg) < 4.5, 'white-on-orange mutant must go red');
      await c.evaluate((el) => el.remove());
      const r = await mp.addStyleTag({ content: 'button[value="clear"] { color: #ef4444 !important; }' });
      const [mr, mg, mb] = parse((await controls(mp)).clear.color);
      assert.ok(mr > mg + 40 && mr > mb + 40, 'red-Clear mutant must go red');
      await r.evaluate((el) => el.remove());
      await mp.close();
    }
    console.log(JSON.stringify({ label, save: m.save.h, clear: m.clear.h, goals: m.goals.h, contrast: ratio(m.save.color, m.save.bg).toFixed(2) }));
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
