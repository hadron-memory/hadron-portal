// portal#1675/#1745: the ApplyAgentTickers result region receives focus after a real apply,
// and must paint a visible ring. Tailwind 4 computes `outline-style: none` when `outline-none`
// sits beside `focus-visible:outline-2`, so the ring was never drawn; the fix scopes the
// suppression to `:focus` and re-states `focus-visible:outline-solid` (same as #1619).
// jsdom has no Tailwind cascade, so this is real Chromium with the compiled app.css and the
// real component. The shared matrix, reader and assertions live in scripts/lib/focus-ring-probe.mjs
// (portal#1745 item 1); what this probe alone owns is HOW each arm drives the flow (item 2):
// the apply is REAL — Enter or a pointer click on the real submit button, the real use:enhance
// round trip (the POST to action '/__apply' is faked at the network layer; kit's deserialize
// gets a success result), and the receipt delivered as the `result` prop the moment the round
// trip answers. settleFocus then hands focus to the region, and the arm asserts the modality
// survived the async round trip: keyboard → :focus-visible + ring, pointer → neither.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:apply-agent-tickers-focus
import { runFocusRingProbe } from './lib/focus-ring-probe.mjs';

const FIXTURE = '/src/lib/test/fixtures/apply-agent-tickers-harness.svelte.ts';

/**
 * One real apply. `via: 'keyboard'` tabs to the submit button (keyboard modality on)
 * and presses Enter; `via: 'pointer'` clicks it (pointer modality). Both drive kit's
 * enhance fetch to /__apply, fulfilled here with a bare success result (no data, so
 * kit's deserialize needs no devalue payload), then deliver the receipt prop.
 */
async function driveApply(page, via) {
  let posted;
  const postedPromise = new Promise((resolve) => { posted = resolve; });
  await page.route('**/__apply', async (route) => {
    posted(route.request().url());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'success', status: 200 }) });
  });
  // Bound the wait for the round trip: an arm that never submits must fail HERE, named —
  // not hang until some outer timeout with no cause (Basil P3-2, portal#1751 review).
  const POST_DEADLINE_MS = 10_000;
  let deadline;
  const postedOrBust = Promise.race([
    postedPromise,
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`${via} apply: no POST to /__apply within ${POST_DEADLINE_MS}ms — the real round trip never started`)), POST_DEADLINE_MS);
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
    // The enhance round trip has answered; deliver the receipt as the loader would.
    await postedOrBust;
    clearTimeout(deadline);
    await page.evaluate(async (module) => {
      const { applyFixture, applyReceipt } = await import(module);
      applyFixture.result = applyReceipt;
    }, FIXTURE);
  } finally {
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
