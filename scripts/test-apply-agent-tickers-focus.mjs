// portal#1675/#1745: the ApplyAgentTickers result region receives focus after a real apply,
// and must paint a visible ring. Tailwind 4 computes `outline-style: none` when `outline-none`
// sits beside `focus-visible:outline-2`, so the ring was never drawn; the fix scopes the
// suppression to `:focus` and re-states `focus-visible:outline-solid` (same as #1619).
// jsdom has no Tailwind cascade, so this is real Chromium with the compiled app.css and the
// real component. The shared matrix, reader and assertions live in scripts/lib/focus-ring-probe.mjs
// (portal#1745 item 1); what this probe alone owns is HOW each arm drives the flow (item 2):
// the apply is REAL — Enter or a pointer click on the real submit button, the real use:enhance
// round trip (the POST to action '/__apply' is faked at the network layer; kit's deserialize
// gets a success result). The receipt is delivered as the `result` prop only AFTER the round
// trip has answered — the response fulfilled, the page's own fetch settled, and one task
// boundary for kit's deserialize chain (Gaia P2-2, portal#1751 BLIND: the first version
// resolved its receipt at interception time, which undercut the survives-the-round-trip
// claim). That delivery is ALIGNMENT, not proof: fetch settles when headers arrive, and kit
// still reads the body, deserializes, and runs the component's enhance callback
// (invalidateAll, update) after it — no fixed task count pins that (Gaia P3-3, portal#1751
// BLIND delta). The PROOF is where focus goes: the harness (focus-ring-probe.mjs) waits for
// focus to land on the region before asserting anything, and ApplyAgentTickers hands focus
// to the region in settleFocus — the LAST await of its enhance callback — so focus-on-region
// can only happen after the whole client-side chain has run, and the modality assertions
// cannot race it: keyboard → :focus-visible + ring, pointer → neither.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:apply-agent-tickers-focus
import { runFocusRingProbe } from './lib/focus-ring-probe.mjs';

const FIXTURE = '/src/lib/test/fixtures/apply-agent-tickers-harness.svelte.ts';

/**
 * One real apply. `via: 'keyboard'` tabs to the submit button (keyboard modality on)
 * and presses Enter; `via: 'pointer'` clicks it (pointer modality). Both drive kit's
 * enhance fetch to /__apply, fulfilled here with a bare success result (no data, so
 * kit's deserialize needs no devalue payload). The `answered` receipt resolves only
 * after `route.fulfill()` has sent the response — interception time no longer counts —
 * and the receipt PROP is not delivered until the page's own fetch has settled plus one
 * task boundary. That is best-effort alignment with the round trip (see the header);
 * the hard synchronization is the harness's focus wait, which the component's own
 * settleFocus — the last await of its enhance callback — cannot satisfy early.
 */
async function driveApply(page, via) {
  let answered;
  const answeredPromise = new Promise((resolve) => { answered = resolve; });
  await page.route('**/__apply', async (route) => {
    // Fulfill FIRST: `answered` means the response was sent, not merely intercepted
    // (Gaia P2-2 — the old posted()-before-fulfill ordering resolved early).
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'success', status: 200 }) });
    answered(route.request().url());
  });
  // Observe the page's own side of the round trip from the network seam: capture the
  // /__apply fetch promise, so "settled" is the page's fetch resolving — not just the
  // response existing on the wire.
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__applySettled = null;
    window.fetch = (...args) => {
      const p = orig(...args);
      if (String(args[0]).includes('/__apply')) window.__applySettled = p.then(() => {}, () => {});
      return p;
    };
  });
  // Bound the wait for the round trip: an arm that never submits must fail HERE, named —
  // not hang until some outer timeout with no cause (Basil P3-2, portal#1751 review).
  const POST_DEADLINE_MS = 10_000;
  let deadline;
  const answeredOrBust = Promise.race([
    answeredPromise,
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`${via} apply: no answered POST to /__apply within ${POST_DEADLINE_MS}ms — the real round trip never started`)), POST_DEADLINE_MS);
    }),
  ]);
  try {
    const button = page.getByRole('button', { name: 'Apply the Agent’s tickers' });
    if (via === 'keyboard') {
      // A real Tab from the body lands on the apply button — the first and only control —
      // and establishes keyboard modality. The Enter that follows is the real submit.
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => document.activeElement?.tagName === 'BUTTON');
      await page.keyboard.press('Enter');
    } else {
      await button.click();
    }
    // The response is out; now the page's own round trip: fetch settled, then one task
    // boundary for kit's deserialize/enhance chain — then the receipt, as the loader
    // would deliver it. Best-effort alignment only (fetch settles at headers; kit's
    // chain continues past it) — the hard gate is the harness's wait for focus on the
    // region, which settleFocus, the callback's last await, only satisfies once that
    // chain is done (Gaia P3-3, portal#1751 BLIND delta).
    await answeredOrBust;
    await page.evaluate(() => {
      if (!window.__applySettled) throw new Error('apply fetch was not observed through window.fetch');
      return window.__applySettled;
    });
    await page.evaluate(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
    await page.evaluate(async (module) => {
      const { applyFixture, applyReceipt } = await import(module);
      applyFixture.result = applyReceipt;
    }, FIXTURE);
  } finally {
    // Cleared on EVERY exit, not just success: an arm that throws before the POST
    // (Cooper's P3 on the d9c289cb delta note) would otherwise leave the 10s deadline
    // armed to reject into an unobserved promise, surfacing as an unhandled rejection
    // long after this drive gave up.
    clearTimeout(deadline);
    await page.unroute('**/__apply');
  }
}

await runFocusRingProbe({
  name: 'apply-agent-tickers',
  elementId: 'apply-tickers-result',
  fixtureModule: FIXTURE,
  fixtureCall: 'mountApplyAgentTickers',
  // src/app.css @theme remaps every indigo-* to the brand palette; --color-indigo-500 is
  // #1a8ba8. Asserting the computed colour pins the remap itself (a stock-Tailwind ring
  // would read rgb(99, 102, 241) and go red), not just "some outline of width ≥ 2".
  expectedColor: 'rgb(26, 139, 168)',
  keyboard: (page) => driveApply(page, 'keyboard'),
  pointer: (page) => driveApply(page, 'pointer'),
});
