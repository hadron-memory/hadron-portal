// portal#1745 item 1: the ONE shared Chromium focus-ring probe harness.
//
// Two probes (ApplyAgentTickers #1675, Task integrations #1619) had grown ~65 verbatim
// shared lines and drifted (screenshot clip height 240 vs 140); a defect seeded into the
// shared scaffolding reddened only the copy it landed in. Everything both probes do the
// same way lives HERE now — mount with Vite-reload retry, the ring reader, the width×scheme
// matrix, the keyboard/pointer arms, the assertions, the screenshot band — and each probe
// supplies only what is genuinely its own: which element, which fixture mounts it, and how
// each arm drives focus (portal#1745's parameterized shape, per scripts/test-relation-focus.mjs).
//
// The assertions pin more than "an outline exists":
//   - the ring COLOUR is asserted equal to the brand remap of indigo-500, so dropping the
//     @theme override in src/app.css (ring falls back to stock indigo) goes red, not just
//     "some ≥2px outline";
//   - the viewport check uses the element box PLUS the real outline extents, so it fails
//     when the ring would actually be clipped, not never under the fixture's margin;
//   - the screenshot clip is computed from the element box, so the band always contains
//     the ring (the old fixed bands could exclude it).
//
// Real Chromium is the point: jsdom computes no Tailwind cascade, so it cannot see
// `outline-none` beating `focus-visible:outline-2` (the #1619/#1675 defect class;
// hrn:node:hadronmemory.com:hadron-portal:review:unconditional-outline-none-hides-focus-ring).
// Setup: pnpm exec playwright install chromium
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// portal#1151: Vite may re-optimise dependencies on first import and reload the page;
// scripts/test-relation-focus.mjs additionally sees `effect_orphan` on cold mounts.
// Retry the whole mount (route → goto → style → fixture import) for those signatures
// only, capped — a persistent component error still fails the probe. Every retry is
// logged so a mount that only passes on a retry is visible in the run.
const MOUNT_RETRYABLE = /Execution context was destroyed|navigation|effect_orphan/i;
const MOUNT_ATTEMPTS = 3;

/** Mount a fixture section into a bare page served by the probe's own Vite server. */
export async function mountSection(page, origin, css, { module, call }) {
  await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>focus</title>' }));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: '#col { max-width: 640px; margin: 24px 16px; }' });
      await page.evaluate(async ({ module, call }) => {
        const fixture = await import(/* @vite-ignore */ module);
        fixture[call](document.getElementById('col'));
      }, { module, call });
      return;
    } catch (e) {
      if (attempt >= MOUNT_ATTEMPTS || !MOUNT_RETRYABLE.test(String(e))) throw e;
      console.log(`retry cold Vite mount ${attempt + 1}: ${String(e).split('\n')[0]}`);
    }
  }
}

/** The focus/outline computed state of the element under probe. */
export const ringReader = (page, elementId) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  return {
    present: true,
    focused: document.activeElement === el,
    focusVisible: el.matches(':focus-visible'),
    style: cs.outlineStyle,
    width: parseFloat(cs.outlineWidth),
    color: cs.outlineColor,
  };
}, elementId);

/** The element's box plus the outline extents a painted ring would occupy. */
const ringBox = (page, elementId) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.width, height: rect.height,
    outlineWidth: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset),
    viewportWidth: innerWidth, viewportHeight: innerHeight,
  };
}, elementId);

/**
 * Run one focus-ring probe: the width×scheme matrix, a keyboard arm (ring must paint)
 * and a pointer arm (no ring), against one element mounted by one fixture.
 *
 * @param {object} config
 * @param {string} config.name — probe name for labels and screenshot file names
 * @param {string} config.elementId — the id the ring is asserted on
 * @param {string} config.fixtureModule — Vite path of the fixture module ('/src/lib/test/fixtures/…')
 * @param {string} config.fixtureCall — the fixture's mount export name
 * @param {string} config.expectedColor — the ring colour the brand remap must produce
 *   (asserted equal in BOTH schemes; the remap in src/app.css is global, not per-scheme)
 * @param {(page: import('playwright').Page, label: string) => Promise<void>} config.keyboard
 *   — drives the real flow by keyboard; must end with focus settled on the element
 * @param {(page: import('playwright').Page, label: string) => Promise<void>} config.pointer
 *   — drives the real flow by pointer; must end with focus settled on the element
 */
export async function runFocusRingProbe({ name, elementId, fixtureModule, fixtureCall, expectedColor, keyboard, pointer }) {
  assert.ok(expectedColor, `${name}: an expected ring colour is required — the brand remap is part of the pin`);
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    const origin = server.resolvedUrls.local[0];
    // The compiled stylesheet is the probe's whole point. An unchecked fetch here could
    // silently assert against the dev server's index.html (a redirect/404 body) — no
    // cascade at all, and every ring assertion vacuously "passes" with no outline. Checked.
    const cssResponse = await fetch(new URL('src/app.css?direct', origin));
    assert.ok(cssResponse.ok, `app.css?direct fetch failed: ${cssResponse.status} ${cssResponse.statusText}`);
    const css = await cssResponse.text();
    assert.ok(css.length > 0, 'app.css?direct returned an empty stylesheet');
    browser = await chromium.launch({ headless: true });

    for (const width of [390, 1280]) {
      for (const scheme of ['light', 'dark']) {
        const label = `${name} ${width}px ${scheme}`;
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await mountSection(page, origin, css, { module: fixtureModule, call: fixtureCall });
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');
        // Attached, not visible: an empty live region (no result yet) is zero-height and
        // counts as hidden — the arms drive the flow that fills and focuses it.
        await page.waitForSelector(`#${elementId}`, { state: 'attached' });

        // Keyboard arm: the real flow driven by the keyboard. The ring must paint —
        // and :focus-visible must match, which pins that the flow PRESERVES keyboard
        // modality through whatever async it does (portal#1745 item 2).
        await keyboard(page, label);
        await page.waitForFunction((id) => document.activeElement?.id === id, elementId);
        const kb = await ringReader(page, elementId);
        assert.ok(kb.present, `${label}: #${elementId} is not in the DOM after the keyboard arm`);
        assert.ok(kb.focused && kb.focusVisible, `${label}: element must be focused and match :focus-visible after the real keyboard flow (${JSON.stringify(kb)})`);
        assert.notEqual(kb.style, 'none', `${label}: keyboard focus ring is not painted, outline-style is none (${JSON.stringify(kb)})`);
        assert.ok(kb.width >= 2, `${label}: ring is narrower than 2px (${JSON.stringify(kb)})`);
        assert.equal(kb.color, expectedColor, `${label}: ring colour is not the brand remap of indigo-500 (src/app.css @theme) — got ${kb.color}`);

        // The painted ring (width + offset out of the box) must sit inside the viewport.
        // Extents come from the element's own computed outline, so this fails when the
        // ring would actually be clipped — the fixture margin alone cannot mask it.
        const box = await ringBox(page, elementId);
        const extents = box.outlineWidth + Math.max(box.offset, 0);
        assert.ok(
          box.left - extents >= 0 && box.top - extents >= 0 && box.right + extents <= box.viewportWidth && box.bottom + extents <= box.viewportHeight,
          `${label}: ring would be clipped by the viewport (${JSON.stringify(box)})`,
        );
        // Evidence for the UX seat: FOCUS_SHOTS=<dir> saves the rendered state. The clip
        // band is computed from the element box plus the ring extents, so the shot always
        // contains the ring (a fixed band from the origin could exclude it entirely).
        if (process.env.FOCUS_SHOTS) {
          const pad = extents + 8;
          const x = Math.max(0, Math.round(box.left - pad));
          const y = Math.max(0, Math.round(box.top - pad));
          await page.screenshot({
            path: `${process.env.FOCUS_SHOTS}/${name}-${width}-${scheme}.png`,
            clip: { x, y, width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) },
          });
        }

        // Pointer arm: the same flow driven by a pointer. Focus still settles on the
        // element, but pointer modality must NOT match :focus-visible and must not paint
        // (Gil's ask, portal#1745 item 2). What this pins is the modality split on the
        // real flow — NOT the focus:outline-none token: outline-style's UA initial is
        // none, so dropping the token leaves plain-:focus unpainted too and this arm
        // stays green (verified empirically on #1745; see the PR body). The token is
        // belt-and-braces against a UA/CSS change to that initial, not a pinned fact.
        await pointer(page, label);
        await page.waitForFunction((id) => document.activeElement?.id === id, elementId);
        const ptr = await ringReader(page, elementId);
        assert.ok(ptr.focused && !ptr.focusVisible, `${label}: a pointer-driven focus must not match :focus-visible (${JSON.stringify(ptr)})`);
        assert.equal(ptr.style, 'none', `${label}: pointer-driven focus must not paint a ring (${JSON.stringify(ptr)})`);

        await page.close();
        console.log(`ok ${label}: keyboard ring ${kb.style} ${kb.width}px ${kb.color}; pointer none`);
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
}
