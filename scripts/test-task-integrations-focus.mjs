// portal#1619 (first slice) / #1745: the Task integrations heading receives focus after a
// keyboard Cancel, and must paint a visible ring. Tailwind 4 computes `outline-style: none`
// when `outline-none` / `focus:outline-none` sits beside `focus-visible:outline-2`, so the
// ring was never drawn. jsdom has no Tailwind cascade, so this is real Chromium with the
// compiled app.css and the real component. Same cause as #1675 (ApplyAgentTickers), which
// keeps its own slice. The shared matrix, reader and assertions live in
// scripts/lib/focus-ring-probe.mjs (portal#1745 item 1); what this probe alone owns is how
// each arm drives the flow: Edit then Cancel, both by the keyboard (focus returns to the
// heading through the component's own settle), or a direct pointer click on the heading.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-integrations-focus
import { runFocusRingProbe } from './lib/focus-ring-probe.mjs';

await runFocusRingProbe({
  name: 'task-integrations',
  elementId: 'task-integrations-heading',
  fixtureModule: '/src/lib/test/fixtures/task-integrations-harness.ts',
  fixtureCall: 'mountTaskIntegrations',
  // src/app.css @theme remaps every indigo-* to the brand palette; --color-indigo-500 is
  // #1a8ba8. Asserting the computed colour pins the remap itself, not just "width ≥ 2".
  expectedColor: 'rgb(26, 139, 168)',
  // Keyboard: Edit, then Cancel, both driven by the keyboard (page.focus + Enter — the
  // Enter keydowns keep keyboard modality on, so the heading's programmatic focus lands
  // in :focus-visible exactly as a keyboard user's Cancel would).
  keyboard: async (page) => {
    await page.focus('button:has-text("Edit")');
    await page.keyboard.press('Enter');
    await page.waitForSelector('button:has-text("Cancel")');
    await page.focus('button:has-text("Cancel")');
    await page.keyboard.press('Enter');
  },
  // Pointer: a click that focuses the heading keeps its old behaviour, no ring. The click
  // at (1,1) first settles pointer modality; the heading click itself focuses it.
  pointer: async (page) => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.click(1, 1);
    await page.click('#task-integrations-heading');
  },
});
