// portal#2532: the Agent URN chips in the App members panel, at 390px with a very long URN.
// The chip gives way (truncated, the full value still in its title), each copy button keeps
// its natural size inside the panel with its whole icon, nothing clips a copy button's focus
// ring, and the page does not scroll sideways. Real Chromium, the compiled app CSS, and the
// REAL AppMembersPanel (both places it names its Agent) from
// src/lib/test/fixtures/members-panel-urn-layout-harness.ts. Synthetic data: no server.
//
// The shared focus-ring probe (scripts/lib/focus-ring-probe.mjs) can now start Vite with the
// client lane's stubs (its `serverConfig` option, portal#2537), which is what mounting a page that
// uses superforms needs. This script still runs its own checks, on purpose: the probe asserts
// the brand ring colour and a pointer arm, while these copy buttons keep Chromium's default `auto`
// ring (see the ring check below), and this script's point is the layout: no clipping ancestor
// between the button and the panel. It uses the client lane's stubs as scripts/test-app-keys-layout.mjs does.
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
// How many lines name the Agent by URN in each variant (the panel's two places; `empty` shows both).
const EXPECTED_LINES = { roles: 1, empty: 2 };

/** Measured inside the page: every box the checks need, for one mounted variant. */
function measure(variant) {
  const host = document.getElementById('host');
  const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  // Every line that names the Agent is found by the Agent link it holds, not by its copy: that copy
  // goes through t() and would break this script on a wording or locale change. The `roles` variant
  // renders one such line; `empty` renders two (the roles line, then the empty-roles warning).
  const lines = [...host.querySelectorAll('a[href="/app/agents/ag1"]')].map((a) => a.closest('p'));
  if (lines.some((l) => !l)) throw new Error(`an Agent link in the ${variant} variant is not inside a paragraph`);
  // One line per link: two links in one paragraph would count twice and measure the same chip twice.
  if (new Set(lines).size !== lines.length) throw new Error(`the ${variant} variant has two Agent links in one paragraph`);
  const chips = lines.map((l) => l.querySelector('span[title]'));
  const copies = lines.flatMap((l, i) => ['Copy URN', 'Copy URL'].map((name) => ({ line: i + 1, el: l.querySelector(`button[aria-label="${name}"]`) })));
  const clips = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain);
  };
  return {
    host: box(host),
    lines: lines.length,
    chipTitles: chips.map((c) => c.title),
    chipsTruncated: chips.map((c) => c.scrollWidth > c.clientWidth + 1),
    copies: copies.map(({ line, el: b }) => {
      const svg = b.querySelector('svg');
      const ancestors = [];
      for (let el = b.parentElement; el && el !== host.parentElement; el = el.parentElement) {
        // Its own ring is the Urn root's business; any ancestor that clips cuts the ring.
        if (clips(el)) {
          const a = el.getBoundingClientRect();
          const btn = b.getBoundingClientRect();
          // The 2px ring plus its 2px offset around the button, against the clipping box.
          const cut = btn.left - 4 < a.left || btn.right + 4 > a.right || btn.top - 4 < a.top || btn.bottom + 4 > a.bottom;
          ancestors.push(`${el.tagName.toLowerCase()}.${el.className}${cut ? ' (cuts the ring)' : ''}`);
        }
      }
      return { name: `${b.getAttribute('aria-label')} (line ${line})`, box: box(b), svg: box(svg), clippingAncestors: ancestors };
    }),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

const ring = (page, name, line) => page.evaluate(({ label, line }) => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  const b = el.getBoundingClientRect();
  return {
    label: el.getAttribute('aria-label'), wanted: label,
    // The focused button must sit in the paragraph of the Agent link the Tab started from.
    inLine: el.closest('p') === document.querySelectorAll('a[href="/app/agents/ag1"]')[line]?.closest('p'),
    focusVisible: el.matches(':focus-visible'),
    style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), color: cs.outlineColor,
    left: b.left, right: b.right, top: b.top, bottom: b.bottom, viewport: innerWidth,
  };
}, { label: name, line });

if (process.env.MEMBERS_URN_SHOTS) mkdirSync(process.env.MEMBERS_URN_SHOTS, { recursive: true });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  assert.ok(origin, 'the Vite server reported no local URL (it did not bind 127.0.0.1)');
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `app.css?direct fetch failed: ${cssResponse.status}`);
  const css = await cssResponse.text();
  assert.ok(css.length > 0, 'app.css?direct returned an empty stylesheet');
  browser = await chromium.launch({ headless: true });

  for (const scheme of ['light', 'dark']) {
    for (const variant of VARIANTS) {
      const label = `${WIDTH}px ${scheme} ${variant}`;
      const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
      // Collected, not thrown: a throw inside an emitter callback is an uncaught exception that kills the
      // process with a stack that says nothing about which leg failed. The list is asserted below.
      const pageErrors = [];
      // Closed on a failure too: the browser close below would reap it, but a failing leg should not
      // leave its page open while the error unwinds.
      try {
        let navigations = 0;
        page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });
        page.on('pageerror', (e) => { pageErrors.push(String(e)); });
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
          // The harness returns its unmount; kept so the leg can tear the panel down and check that too.
          window.unmountPanel = await mountMembersPanel(document.getElementById('host'), v);
        }, variant);
        await page.waitForSelector('#host a[href="/app/agents/ag1"]');
        await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        // A reload under the mounted panel (Vite re-optimising a late dependency) makes every
        // measurement after it meaningless: refuse it rather than pass on a half-mounted page.
        assert.equal(navigations, 1, `${label}: the page reloaded ${navigations - 1} time(s) under the mount`);

        const got = await page.evaluate(measure, variant);
        assert.equal(got.lines, EXPECTED_LINES[variant], `${label}: precondition: the panel names its Agent on ${got.lines} line(s), expected ${EXPECTED_LINES[variant]}`);
        assert.deepEqual(got.chipsTruncated, got.chipsTruncated.map(() => true), `${label}: precondition: every long URN must be truncated`);
        assert.ok(got.chipTitles.every((t) => t.length >= 100), `${label}: precondition: the URN is long`);
        assert.ok(got.pageOverflow <= 0, `${label}: the page scrolls sideways by ${got.pageOverflow}px`);
        for (const copy of got.copies) {
          const at = `${label}: ${copy.name}`;
          assert.ok(Math.abs(copy.box.width - 8) < 0.5 && Math.abs(copy.box.height - 8) < 0.5, `${at} is ${copy.box.width}x${copy.box.height}, not its natural 8x8`);
          assert.ok(copy.box.left >= got.host.left - 0.5 && copy.box.right <= got.host.right + 0.5, `${at} lies outside the panel (${copy.box.left}-${copy.box.right} vs ${got.host.left}-${got.host.right})`);
          assert.ok(copy.svg.left >= copy.box.left - 0.5 && copy.svg.right <= copy.box.right + 0.5 && Math.abs(copy.svg.width - 8) < 0.5, `${at}: the icon is not whole inside its button (${JSON.stringify(copy.svg)})`);
          assert.deepEqual(copy.clippingAncestors, [], `${at} sits under an ancestor that clips its focus ring`);
        }

        // Keyboard focus on each copy button: the ring paints (its colour is not asserted, see below), and its
        // whole extent (outline width plus offset) lies inside the viewport.
        for (let line = 0; line < got.lines; line++) {
          for (const name of ['Copy URN', 'Copy URL']) {
            await page.locator('#host a[href="/app/agents/ag1"]').nth(line).focus();
            let r;
            // Assumes each button is reached within six Tab presses of its line's Agent link, in the
            // chip's order (Copy URN, then Copy URL). A reordered chip or a longer path fails here, loudly.
            for (let i = 0; i < 6; i++) {
              await page.keyboard.press('Tab');
              r = await ring(page, name, line);
              if (r.label === name && r.inLine) break;
            }
            assert.ok(r.label === name && r.inLine, `${label}: Tab never reached ${name} on line ${line + 1} (${JSON.stringify(r)})`);
            assert.ok(r.focusVisible, `${label}: ${name} does not match :focus-visible after Tab`);
            assert.notEqual(r.style, 'none', `${label}: ${name} paints no ring (${JSON.stringify(r)})`);
            // The copy buttons carry no focus-visible styling of their own, so Chromium's default
            // `auto` ring paints (1px computed, drawn about 2px): this checks it paints and fits,
            // not its colour. A branded ring on these buttons is a design change, not this issue.
            const extent = Math.max(r.width, 2) + Math.max(r.offset, 0);
            assert.ok(r.left - extent >= 0 && r.right + extent <= r.viewport, `${label}: ${name} ring would leave the viewport (${JSON.stringify(r)})`);
            if (process.env.MEMBERS_URN_SHOTS) {
              await page.screenshot({ path: join(process.env.MEMBERS_URN_SHOTS, `members-urn-${variant}-line${line + 1}-${scheme}-${name.replace(' ', '-').toLowerCase()}.png`), clip: { x: 0, y: Math.max(0, r.top - 60), width: WIDTH, height: 120 } });
            }
          }
        }
        // Tearing the panel down must not throw either: an effect that fails on unmount lands in pageerror.
        await page.evaluate(async () => { window.unmountPanel(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        assert.deepEqual(pageErrors, [], `${label}: the page raised uncaught errors`);
        console.log(`ok ${label}: ${got.lines} Agent line(s): chip truncated, both copy buttons 8x8 inside the panel, no clipping ancestor, rings whole, no page errors`);
      } catch (e) {
        // A failure before the final assertion (a timeout, a missing selector) is often caused by a page
        // error; print what was collected so the real cause is not hidden behind the symptom.
        if (pageErrors.length) console.error(`${label}: page errors before the failure:\n${pageErrors.join('\n')}`);
        throw e;
      } finally {
        // Must not mask the error above if the page is already gone.
        await page.close().catch(() => {});
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
