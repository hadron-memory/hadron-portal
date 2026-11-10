// portal#1711: the TaskHistory link values in real Chromium with the compiled app.css and
// the real components. jsdom computes no `pointer-coarse:` height and measures no overflow,
// and the issue's acceptance for the touch targets is measured, not class-checked.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-history-links-layout
// TH_SHOTS=<dir> also saves each state, captioned with its measured heights, for the PR.
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
  const kind = (a) => {
    if (a.href.includes('/runs/')) return 'run';
    if (a.href.includes('/tasks/')) return 'task';
    if (a.href.includes('/app/u/hrn:')) return 'chip';
    return 'url'; // the external https anchors (pull request, receipt)
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

      const o = await overflow(page);
      assert.ok(o.history <= 0.5 && o.page <= 0.5, `${label}: overflows ${JSON.stringify(o)}`);

      const measured = await anchors(page);
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
      // findings:playwright-screenshots-after-layout-assertions).
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
