// portal#2379: a persistent live region must not change the layout of the column it sits in. The same
// `space-y` column is rendered with the old conditional box and with LiveRegion / LiveOutcome, in real
// Chromium with compiled app.css, and the column heights must match with no message, a status and an alert,
// with the message last in the column and with a control after it. Synthetic data only.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:live-outcome-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.equal(cssResponse.status, 200, `app.css was not served (HTTP ${cssResponse.status})`);
  const css = await cssResponse.text();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/__live_outcome_layout_fixture*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>test-live-outcome-layout</title>' }));
  assert.equal((await page.goto(new URL('/__live_outcome_layout_fixture', origin).href))?.status(), 200);
  const heightOf = (props) => page.evaluate(async ({ css, props }) => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<style>${css}</style><main id="app"></main>`;
    const { mountColumn } = await import('/src/lib/test/fixtures/live-outcome-layout-harness.ts');
    mountColumn(document.getElementById('app'), props);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector('[data-testid="column"]').getBoundingClientRect().height;
  }, { css, props });
  // What "layout unchanged" means here. A region is a sibling, so in a `space-y` column that is its LAST child
  // the previous sibling keeps the spacing it only needed when something followed it: an IDLE region at the end
  // of a column leaves one trailing gap (the convention says to accept that, LiveRegion has it too). So:
  //   - LiveRegion matches the old conditional box whenever a message shows or a control follows it;
  //   - LiveOutcome matches LiveRegion exactly for none/status (it adds no gap of its own: that is the
  //     `:has` rule), and matches the old conditional box exactly when an alert shows.
  const notes = [['none', null], ['status', { text: 'Saved.', failed: false }], ['alert', { text: 'Refused.', failed: true }]];
  const near = (a, b, why) => assert.ok(Math.abs(a - b) <= 0.5, `${why}: ${a}px vs ${b}px`);
  const rows = [];
  for (const trailing of [false, true]) {
    for (const [label, note] of notes) {
      const plain = await heightOf({ mode: 'plain', note, trailing });
      const region = note?.failed ? null : await heightOf({ mode: 'region', note, trailing });
      const outcome = await heightOf({ mode: 'outcome', note, trailing });
      rows.push({ note: label, trailing, plain, region, outcome });
      if (region !== null && (label === 'status' || trailing)) near(region, plain, `LiveRegion / ${label} / trailing=${trailing} vs the old conditional box`);
      if (region !== null) near(outcome, region, `LiveOutcome / ${label} / trailing=${trailing} vs LiveRegion`);
      if (note?.failed) near(outcome, plain, `LiveOutcome / alert / trailing=${trailing} vs the old conditional box`);
      if (trailing) near(outcome, plain, `LiveOutcome / ${label} / trailing=true vs the old conditional box`);
    }
  }
  // Control: without the :has rule the status-last case grows; proves this check can see the trap.
  const control = await page.evaluate(async ({ css }) => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<style>${css}</style><div data-testid="column" class="flow-root space-y-3"><p>Above</p><div role="status" class="empty:m-0"><p class="rounded-lg border px-3 py-2 text-sm">Saved.</p></div><div role="alert" class="empty:m-0"></div></div>`;
    await new Promise((r) => requestAnimationFrame(r));
    return document.querySelector('[data-testid="column"]').getBoundingClientRect().height;
  }, { css });
  const reference = rows.find((r) => r.note === 'status' && !r.trailing).plain;
  assert.ok(control > reference + 4, `control: two plain sibling regions leave a trailing gap (${control}px vs ${reference}px)`);
  console.log(JSON.stringify({ ok: true, checked: rows.length, control, reference }));
} finally {
  await browser?.close(); await server.close();
}
