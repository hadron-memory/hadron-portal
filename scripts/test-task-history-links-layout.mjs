// portal#1711: the TaskHistory link values in real Chromium with the compiled app.css and
// the real components. jsdom computes no `pointer-coarse:` height and measures no overflow,
// and the issue's acceptance for the touch targets is measured, not class-checked.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-history-links-layout
// TH_SHOTS=<dir> also saves each state, captioned with its measured heights, for the PR.
// TH_EXTRA_ANCHOR=<path> adds one same-origin anchor to the history after mount (portal#1925):
// an in-app link of a kind the probe does not know. The run must FAIL; a pass means an
// unclassified anchor slips past the 44px gate.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const TARGET = 44;
// portal#1711 item 3, "fine pointer unchanged": the only classes this change adds
// under fine pointer are `break-all` (wraps a long value; no per-line effect) and
// `pointer-coarse:*` variants (inert under a fine pointer). The guard is therefore a
// LEAK pin, not an exact table: a coarse padding reaching fine pointer would lift a
// single line to 24px or more (py-4 alone adds 32px). Measured fine lines are
// 14–20px; the PR records them as evidence.
const FINE_LINE_MAX = 24;

// portal#1151: Vite may re-optimise dependencies on first import and reload the page; start again.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountHistory(page, origin, css, dark) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        document.body.style.color = dark ? '#fafafa' : '#18181b';
      }, { css, dark });
      await page.addStyleTag({ content: '#col { max-width: 640px; margin: 24px 16px; }' });
      await page.evaluate(async () => {
        const { mountTaskHistory } = await import('/src/lib/test/fixtures/task-history-links-layout-harness.ts');
        mountTaskHistory(document.getElementById('col'));
      });
      await page.waitForSelector('[data-testid="task-history"]');
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

/** Every anchor in the history, keyed by the kind this change owns, with its box and line count. */
const anchors = (page) => page.evaluate(() => {
  const history = document.querySelector('[data-testid="task-history"]');
  // Origin first (portal#1922 BLIND P3-10): an external url whose path happens to
  // contain `/tasks/` or `/runs/` must not be misread as an in-app link.
  const kind = (a) => {
    if (a.origin !== location.origin) return 'url'; // the external https anchors (pull request, receipt)
    if (a.pathname.includes('/runs/')) return 'run';
    if (a.pathname.includes('/tasks/')) return 'task';
    // The shared Urn resolver chip, matched exactly (portal#1925): a same-origin anchor of any
    // other shape is 'other', never silently exempted from the coarse 44px check as a chip.
    if (a.pathname.startsWith('/app/u/hrn:')) return 'chip';
    return 'other';
  };
  return [...history.querySelectorAll('a')].map((a) => {
    const range = document.createRange();
    range.selectNodeContents(a);
    const r = a.getBoundingClientRect();
    return {
      kind: kind(a),
      href: a.getAttribute('href'),
      height: r.height,
      width: r.width,
      // One rect per rendered line for an inline anchor: >1 means the value wrapped
      // inside its anchor. (Meaningless for the inline-flex chip, excluded below.)
      lines: [...range.getClientRects()].length,
    };
  });
});
/** The shared Urn chip's own controls in the history (copy buttons, reveal toggle):
 * their coarse targets are the chip's own gate (#1686), verified here in place. */
const chipControls = (page) => page.evaluate(() => {
  const history = document.querySelector('[data-testid="task-history"]');
  const chip = history.querySelector('a[href*="/app/u/hrn:"]');
  const root = chip?.parentElement;
  if (!root) return [];
  return [...root.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { name: b.getAttribute('aria-label'), height: r.height, width: r.width };
  });
});
const overflow = (page) => page.evaluate(() => {
  const history = document.querySelector('[data-testid="task-history"]');
  return { history: history.scrollWidth - history.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

async function shot(page, label, heights) {
  if (!process.env.TH_SHOTS) return;
  await page.evaluate((text) => {
    let p = document.getElementById('heights');
    if (!p) { p = document.createElement('pre'); p.id = 'heights'; p.style.cssText = 'font: 11px monospace; white-space: pre-wrap; margin: 8px 16px;'; document.body.prepend(p); }
    p.textContent = text;
  }, `${label}\n${heights}`);
  const path = `${process.env.TH_SHOTS}/${label.replaceAll(' ', '-')}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `app.css fetch failed: ${cssResponse.status} ${cssResponse.statusText}`);
  const css = await cssResponse.text();
  browser = await chromium.launch({ headless: true });

  for (const [width, coarse] of [[390, false], [390, true], [1280, false], [1280, true]]) {
    for (const scheme of ['light', 'dark']) {
      const label = `${width} ${coarse ? 'coarse' : 'fine'} ${scheme}`;
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await mountHistory(page, origin, css, scheme === 'dark');
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), coarse, `${label}: pointer emulation`);
      if (process.env.TH_EXTRA_ANCHOR) {
        await page.evaluate((path) => {
          const a = document.createElement('a');
          a.href = path;
          a.textContent = 'extra';
          document.querySelector('[data-testid="task-history"]').append(a);
        }, process.env.TH_EXTRA_ANCHOR);
      }

      const o = await overflow(page);
      assert.ok(o.history <= 0.5 && o.page <= 0.5, `${label}: overflows ${JSON.stringify(o)}`);

      const measured = await anchors(page);
      // portal#1925: every in-app anchor is a known kind. An unclassified one would skip the
      // 44px check below, so it fails here, before any count or presence pin can be bumped past it.
      const other = measured.filter((a) => a.kind === 'other');
      assert.equal(other.length, 0, `${label}: unclassified in-app anchor(s) ${JSON.stringify(other)}`);
      // The fixture puts every anchor kind on the page; a missing kind means the
      // fixture and the component drifted apart.
      for (const kind of ['run', 'url', 'task', 'chip']) {
        assert.ok(measured.some((a) => a.kind === kind), `${label}: no ${kind} anchor on the page ${JSON.stringify(measured)}`);
      }
      const longUrl = measured.filter((a) => a.href.startsWith('https://github.com/hadron-memory/'));
      assert.equal(longUrl.length, 1, `${label}: expected exactly one long-url anchor ${JSON.stringify(measured)}`);

      if (coarse) {
        // portal#1711 item 3: every anchor box a coarse pointer taps is at least 44px
        // high. The chip anchor itself stays the shared component's own rendering
        // (Urn.svelte is outside this change's files); its tap controls are gated here.
        for (const a of measured.filter((x) => x.kind !== 'chip')) {
          assert.ok(a.height >= TARGET, `${label}: ${a.kind} anchor is ${a.height}px, under ${TARGET}px`);
        }
        const controls = await chipControls(page);
        assert.ok(controls.length > 0, `${label}: the node-URN chip has no tap controls`);
        for (const c of controls) {
          assert.ok(c.height >= TARGET, `${label}: chip control ${c.name} is ${c.height}px, under ${TARGET}px`);
        }

        // portal#1922 BLIND P2: height alone proves nothing — vertical padding on a
        // non-replaced inline anchor reports (and hit-tests) 44px of PHANTOM box
        // that overlaps neighbouring rows without layout making room for it. Three
        // assertions a phantom target cannot pass:
        const guards = await page.evaluate((TARGET) => {
          const history = document.querySelector('[data-testid="task-history"]');
          const overlaps = (r1, r2, slop = 1) =>
            r1.left < r2.right - slop && r2.left < r1.right - slop && r1.top < r2.bottom - slop && r2.top < r1.bottom - slop;
          const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          const problems = [];
          const interactive = [...history.querySelectorAll('a, button')];
          // (1) No two tap targets overlap: where two boxes intersect, tree order —
          // not the reader — decides which one gets the tap.
          for (let i = 0; i < interactive.length; i++) {
            for (let j = i + 1; j < interactive.length; j++) {
              const a = interactive[i], b = interactive[j];
              if (a.contains(b) || b.contains(a)) continue;
              if (overlaps(box(a), box(b))) problems.push(`tap targets overlap: ${a.outerHTML.slice(0, 60)} × ${b.outerHTML.slice(0, 60)}`);
            }
          }
          // (2) No anchor's box covers content it does not own. A reserved box
          // (min-h-11 inline-flex/block) fits inside the space layout gave it;
          // phantom padding spills over the rows above and below.
          for (const a of history.querySelectorAll('a')) {
            const ab = box(a);
            for (const el of history.querySelectorAll('*')) {
              if (el === a || a.contains(el) || el.contains(a)) continue;
              const er = el.getBoundingClientRect();
              if (er.width === 0 || er.height === 0) continue;
              if (overlaps(ab, box(el))) problems.push(`anchor box covers foreign content: ${a.outerHTML.slice(0, 60)} × ${el.outerHTML.slice(0, 60)}`);
            }
          }
          // (3) Every point of the reserved box hit-tests to its own anchor (the
          // centre and ±20px of it, within the box): a target that paints under
          // something else is not tappable there. Offsets that fall outside a
          // target's own box are skipped — the 16px chip anchor's shortfall is the
          // shared component's #1686 gap, not this change's.
          for (const a of interactive) {
            a.scrollIntoView({ block: 'center' });
            const r = a.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            for (const dy of [-20, 0, 20]) {
              const y = r.top + r.height / 2 + dy;
              if (y < r.top + 1 || y > r.bottom - 1) continue;
              if (y < 0 || y >= innerHeight) continue;
              const hit = document.elementFromPoint(cx, y);
              if (hit && hit !== a && !a.contains(hit)) {
                problems.push(`elementFromPoint steals the tap at ${dy}px off-centre of ${a.outerHTML.slice(0, 60)} (hit ${hit.outerHTML.slice(0, 60)})`);
              }
            }
          }
          return problems;
        }, TARGET);
        assert.deepEqual(guards, [], `${label}: coarse target guards\n  ${guards.join('\n  ')}`);
      } else {
        for (const a of measured.filter((x) => x.kind !== 'chip')) {
          const line = a.height / a.lines;
          assert.ok(line <= FINE_LINE_MAX, `${label}: fine ${a.kind} anchor line is ${line}px over ${a.lines} line(s) — coarse padding leaked into fine pointer`);
        }
        // The inline-flex chip reports fragment rects, not lines: pin its whole box
        // stays dense at fine pointer instead.
        const chipAnchor = measured.find((x) => x.kind === 'chip');
        assert.ok(chipAnchor && chipAnchor.height <= FINE_LINE_MAX, `${label}: fine chip anchor grew to ${chipAnchor?.height}px`);
      }
      // portal#1711 item 1: a long value wraps inside its anchor instead of overflowing,
      // at BOTH widths (the column stays 640px, so 1280 wraps the same value).
      for (const a of longUrl) {
        assert.ok(a.lines > 1, `${label}: the long url rendered on ${a.lines} line(s), expected wrapping`);
      }
      // portal#1922 BLIND P3-4: a node URN long enough to overflow is on the page
      // (the e5 verdict), so the overflow the row would cause is MEASURED here —
      // the global overflow assert above is the gate. How the shared chip handles
      // the long value (truncate-by-default, wrap on reveal) is the chip's own
      // #1686 gate, not this change's; the measured shape is printed as evidence.
      const chips = measured.filter((x) => x.kind === 'chip');
      assert.equal(chips.length, 2, `${label}: expected the short and long node-URN chips ${JSON.stringify(measured)}`);
      const longChip = chips.reduce((a, b) => (a.href.length >= b.href.length ? a : b));
      console.log(`    long node-URN chip: ${longChip.height}x${longChip.width}/${longChip.lines}L`);
      const longText = await page.evaluate(() => {
        const code = [...document.querySelectorAll('[data-testid="task-history"] code')].find((c) => c.textContent.startsWith('not-a-url-'));
        if (!code) return null;
        const range = document.createRange();
        range.selectNodeContents(code);
        return { lines: [...range.getClientRects()].length, over: code.scrollWidth - code.clientWidth };
      });
      assert.ok(longText, `${label}: no long text value on the page`);
      assert.ok(longText.lines > 1 && longText.over <= 0.5, `${label}: the long text value did not wrap ${JSON.stringify(longText)}`);
      await page.close();

      // Screenshots are evidence, not test input, and nothing interactive follows a
      // capture on its page: fresh pages, after every assertion (see
      // hrn:node:hadronmemory.com:hadron-portal:findings:playwright-screenshots-after-layout-assertions).
      if (process.env.TH_SHOTS) {
        const shotPage = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
        await shotPage.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
        await mountHistory(shotPage, origin, css, scheme === 'dark');
        const caption = (await anchors(shotPage)).map((a) => `${a.kind} ${a.height}x${a.width}/${a.lines}L`).join(', ');
        await shot(shotPage, label, caption);
        await shotPage.close();
      }
      console.log(`ok ${label}`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
