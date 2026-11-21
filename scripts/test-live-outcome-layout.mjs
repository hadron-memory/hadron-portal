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
  // One MOUNTED fixture per shape, driven idle -> status -> alert -> idle like a real outcome (not remounted
  // per case), measuring the column height AND where the message box and the control after it sit.
  const STEPS = [['idle', null], ['status', { text: 'Saved.', failed: false }], ['alert', { text: 'Refused.', failed: true }], ['idle again', null]];
  const sequence = (props) => page.evaluate(async ({ css, props, steps }) => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<style>${css}</style><main id="app"></main>`;
    const { mountColumn } = await import('/src/lib/test/fixtures/live-outcome-layout-harness.ts');
    const column = mountColumn(document.getElementById('app'), props);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = [];
    for (const [label, note] of steps) {
      column.say(note);
      await frame();
      const box = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? Math.round(el.getBoundingClientRect().top * 10) / 10 : null; };
      out.push({ label, height: document.querySelector('[data-testid="column"]').getBoundingClientRect().height, msgTop: box('msg'), afterTop: box('after') });
    }
    return out;
  }, { css, props, steps: STEPS });
  // What "layout unchanged" means here. A region is a sibling, so in a `space-y` column that is its LAST child
  // the previous sibling keeps the spacing it only needed when something followed it: an IDLE region at the end
  // of a column leaves one trailing gap (the convention says to accept that, LiveRegion has it too). So:
  //   - LiveRegion matches the old conditional box whenever a message shows or a control follows it;
  //   - LiveOutcome matches LiveRegion exactly for idle/status (it adds no gap of its own: the `:has` rule),
  //     and matches the old conditional box exactly when an alert shows or a control follows it;
  //   - the message box and the control after it sit where the old box put them, at every step.
  // A missing element is never a match: `null` must meet `null`, and only a number meets a number (subtraction would
  // coerce null to 0 and let an absent element equal one at 0px).
  const near = (a, b, why) => assert.ok(a === null || b === null ? a === b : Math.abs(a - b) <= 0.5, `${why}: ${a} vs ${b}`);
  const present = (step, key, expected, why) => assert.equal(step[key] !== null, expected, `${why}: ${key} ${expected ? 'missing' : 'unexpectedly present'}`);
  const rows = [];
  for (const hasFollowingControl of [false, true]) {
    const plain = await sequence({ mode: 'plain', hasFollowingControl });
    const region = await sequence({ mode: 'region', hasFollowingControl });
    const outcome = await sequence({ mode: 'outcome', hasFollowingControl });
    STEPS.forEach(([label, note], i) => {
      const at = `${label} / hasFollowingControl=${hasFollowingControl}`;
      for (const [shape, seq] of [['plain', plain], ['region', region], ['outcome', outcome]]) {
        present(seq[i], 'msgTop', !!note, `${shape} / ${at}`);
        present(seq[i], 'afterTop', hasFollowingControl, `${shape} / ${at}`);
      }
      rows.push({ at, plain: plain[i].height, region: region[i].height, outcome: outcome[i].height });
      // Positions: where the message and the control sit, against the old box, in every shape.
      for (const key of ['msgTop', 'afterTop']) {
        near(outcome[i][key], plain[i][key], `LiveOutcome ${key} (${at}) vs the old conditional box`);
        if (!note?.failed) near(region[i][key], plain[i][key], `LiveRegion ${key} (${at}) vs the old conditional box`);
      }
      if (!note?.failed && (note || hasFollowingControl)) near(region[i].height, plain[i].height, `LiveRegion height (${at}) vs the old conditional box`);
      if (!note?.failed) near(outcome[i].height, region[i].height, `LiveOutcome height (${at}) vs LiveRegion`);
      if (note?.failed || hasFollowingControl) near(outcome[i].height, plain[i].height, `LiveOutcome height (${at}) vs the old conditional box`);
    });
  }
  // Control: without the :has rule the status-last case grows; proves this check can see the trap.
  const control = await page.evaluate(async ({ css }) => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<style>${css}</style><div data-testid="column" class="flow-root space-y-3"><p>Above</p><div role="status" class="empty:m-0"><p class="rounded-lg border px-3 py-2 text-sm">Saved.</p></div><div role="alert" class="empty:m-0"></div></div>`;
    await new Promise((r) => requestAnimationFrame(r));
    return document.querySelector('[data-testid="column"]').getBoundingClientRect().height;
  }, { css });
  const reference = rows.find((r) => r.at === 'status / hasFollowingControl=false').plain;
  assert.ok(control > reference + 4, `control: two plain sibling regions leave a trailing gap (${control}px vs ${reference}px)`);
  console.log(JSON.stringify({ ok: true, checked: rows.length, control, reference }));
} finally {
  // Nested, so Vite still shuts down when closing the browser rejects.
  try { await browser?.close(); } finally { await server.close(); }
}
