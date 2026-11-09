// portal#1530 / #1573 — the min-tier help sentence shared by the Edit panel's
// test (TaskEditFields.client.test.ts) and the create page's test
// (tasks/new/page.client.test.ts). Both components carry the same i18n key and
// default; each test pins its component's rendered copy to this one literal,
// so a drift in either component fails that page's test.
//
// It lives here, not in either test file, because importing a test module
// re-runs its describe blocks inside the importer (the #1573 guard,
// no-test-module-imports.test.ts, refuses that).
export const MIN_TIER_HELP =
  'The task goes to the cheapest free worker at or above this tier. When a minimum is selected, a worker whose tier is unknown won’t be picked.';
