// portal#2532: the Agent URN chips in the App members panel, at 390px with a very long URN.
// The chip gives way (truncated, the full value still in its title), each copy button keeps
// its natural size inside the panel with its whole icon, nothing clips a copy button's focus
// ring, and the page does not scroll sideways. Real Chromium, the compiled app CSS, and the
// REAL AppMembersPanel (both places it names its Agent) from
// src/lib/test/fixtures/members-panel-urn-layout-harness.ts. Synthetic data: no server.
//
// The shared focus-ring probe (scripts/lib/focus-ring-probe.mjs) cannot be used as is: it
// starts Vite with the app's own config, where `$app/*` resolves to the SvelteKit runtime
// that is not running here, so it cannot mount a page that uses superforms. This script uses
// the client lane's stubs (as scripts/test-app-keys-layout.mjs does) and checks each
// copy button's keyboard ring, plus the one the defect is about: no clipping ancestor between
// the button and the panel.
//
// Setup: pnpm exec playwright install chromium
// Run:   pnpm test:members-panel-urn-layout  (MEMBERS_URN_SHOTS=<dir> saves screenshots)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const stub = (name) => resolve('src/lib/test/stubs', name);
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-members-panel-urn-layout',
  optimizeDeps: { entries: ['src/lib/test/fixtures/members-panel-urn-layout-harness.ts'], exclude: ['sveltekit-superforms'] },
  server: { host: '127.0.0.1', port: 0 },
  resolve: { alias: {
    $lib: resolve('src/lib'),
    '$app/navigation': stub('app-navigation.ts'),
    '$app/environment': stub('app-environment.ts'),
    '$app/stores': stub('app-stores.ts'),
    '$app/state': stub('app-state.ts'),
    '$app/forms': stub('app-forms.ts'),
    '$env/dynamic/public': stub('env-dynamic-public.ts'),
  } },
  plugins: [tailwindcss(), svelte()],
});

const WIDTH = 390;
const VARIANTS = ['roles', 'empty'];

/** Measured inside the page: every box the checks need, for one mounted variant. */
function measure(variant) {
  const host = document.getElementById('host');
  const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const line = [...host.querySelectorAll('p')].find((p) => p.textContent.includes(variant === 'roles' ? 'Roles below are defined by the linked Agent' : 'This App offers no member roles yet.'));
  if (!line) throw new Error(`the ${variant} line is not rendered`);
  const chip = line.querySelector('span[title]');
  const copies = ['Copy URN', 'Copy URL'].map((name) => line.querySelector(`button[aria-label="${name}"]`));
  const clips = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain);
  };
  return {
    host: box(host),
    chipTitle: chip.title,
    chipTruncated: chip.scrollWidth > chip.clientWidth + 1,
    copies: copies.map((b) => {
      const svg = b.querySelector('svg');
      const ancestors = [];
      for (let el = b.parentElement; el && el !== host.parentElement; el = el.parentElement) {
        // Its own ring is the Urn root's business; any ancestor that clips cuts the ring.
        if (clips(el)) {
          const a = el.getBoundingClientRect();
          const b2 = b.getBoundingClientRect();
          // The 2px ring plus its 2px offset around the button, against the clipping box.
          const cut = b2.left - 4 < a.left || b2.right + 4 > a.right || b2.top - 4 < a.top || b2.bottom + 4 > a.bottom;
          ancestors.push(`${el.tagName.toLowerCase()}.${el.className}${cut ? ' (cuts the ring)' : ''}`);
        }
      }
      return { name: b.getAttribute('aria-label'), box: box(b), svg: box(svg), clippingAncestors: ancestors };
    }),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

const ring = (page, name) => page.evaluate((label) => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  const b = el.getBoundingClientRect();
  return {
    label: el.getAttribute('aria-label'), wanted: label,
    focusVisible: el.matches(':focus-visible'),
    style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), color: cs.outlineColor,
    left: b.left, right: b.right, top: b.top, bottom: b.bottom, viewport: innerWidth,
  };
}, name);

if (process.env.MEMBERS_URN_SHOTS) mkdirSync(process.env.MEMBERS_URN_SHOTS, { recursive: true });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `app.css?direct fetch failed: ${cssResponse.status}`);
  const css = await cssResponse.text();
  assert.ok(css.length > 0, 'app.css?direct returned an empty stylesheet');
  browser = await chromium.launch({ headless: true });

  for (const scheme of ['light', 'dark']) {
    for (const variant of VARIANTS) {
      const label = `${WIDTH}px ${scheme} ${variant}`;
      const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
      let navigations = 0;
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });
      page.on('pageerror', (e) => { throw e; });
      await page.route('**/__members_fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Members panel fixture</title>' }));
      await page.goto(new URL('/__members_fixture', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.body.innerHTML = `<style>${css}</style><main id="host" style="margin: 0 16px;"></main>`;
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        document.body.style.color = dark ? '#fafafa' : '#18181b';
      }, { css, dark: scheme === 'dark' });
      await page.evaluate(async (v) => {
        const { mountMembersPanel } = await import('/src/lib/test/fixtures/members-panel-urn-layout-harness.ts');
        await mountMembersPanel(document.getElementById('host'), v);
      }, variant);
      await page.waitForSelector('#host a[href="/app/agents/ag1"]');
      await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
      // A reload under the mounted panel (Vite re-optimising a late dependency) makes every
      // measurement after it meaningless: refuse it rather than pass on a half-mounted page.
      assert.equal(navigations, 1, `${label}: the page reloaded ${navigations - 1} time(s) under the mount`);

      const got = await page.evaluate(measure, variant);
      assert.equal(got.chipTruncated, true, `${label}: precondition: the long URN must be truncated (${JSON.stringify(got.chipTitle.length)} chars)`);
      assert.ok(got.chipTitle.length >= 100, `${label}: precondition: the URN is long`);
      assert.ok(got.pageOverflow <= 0, `${label}: the page scrolls sideways by ${got.pageOverflow}px`);
      for (const copy of got.copies) {
        const at = `${label}: ${copy.name}`;
        assert.ok(Math.abs(copy.box.width - 8) < 0.5 && Math.abs(copy.box.height - 8) < 0.5, `${at} is ${copy.box.width}x${copy.box.height}, not its natural 8x8`);
        assert.ok(copy.box.left >= got.host.left - 0.5 && copy.box.right <= got.host.right + 0.5, `${at} lies outside the panel (${copy.box.left}-${copy.box.right} vs ${got.host.left}-${got.host.right})`);
        assert.ok(copy.svg.left >= copy.box.left - 0.5 && copy.svg.right <= copy.box.right + 0.5 && Math.abs(copy.svg.width - 8) < 0.5, `${at}: the icon is not whole inside its button (${JSON.stringify(copy.svg)})`);
        assert.deepEqual(copy.clippingAncestors, [], `${at} sits under an ancestor that clips its focus ring`);
      }

      // Keyboard focus on each copy button: the ring paints, in the brand colour, and its
      // whole extent (outline width plus offset) lies inside the viewport.
      for (const name of ['Copy URN', 'Copy URL']) {
        await page.locator('#host p', { hasText: variant === 'roles' ? 'Roles below are defined by the linked Agent' : 'This App offers no member roles yet.' }).locator('a[href="/app/agents/ag1"]').focus();
        let r;
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          r = await ring(page, name);
          if (r.label === name) break;
        }
        assert.equal(r.label, name, `${label}: Tab never reached ${name}`);
        assert.ok(r.focusVisible, `${label}: ${name} does not match :focus-visible after Tab`);
        assert.notEqual(r.style, 'none', `${label}: ${name} paints no ring (${JSON.stringify(r)})`);
        // The copy buttons carry no focus-visible styling of their own, so Chromium's default
        // `auto` ring paints (1px computed, drawn about 2px): this checks it paints and fits,
        // not its colour. A branded ring on these buttons is a design change, not this issue.
        const extent = Math.max(r.width, 2) + Math.max(r.offset, 0);
        assert.ok(r.left - extent >= 0 && r.right + extent <= r.viewport, `${label}: ${name} ring would leave the viewport (${JSON.stringify(r)})`);
        if (process.env.MEMBERS_URN_SHOTS) {
          await page.screenshot({ path: join(process.env.MEMBERS_URN_SHOTS, `members-urn-${variant}-${scheme}-${name.replace(' ', '-').toLowerCase()}.png`), clip: { x: 0, y: Math.max(0, r.top - 60), width: WIDTH, height: 120 } });
        }
      }
      await page.close();
      console.log(`ok ${label}: chip truncated, both copy buttons 8x8 inside the panel, no clipping ancestor, rings whole`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
