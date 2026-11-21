# Portal #1942 component evidence

Synthetic rows in the real Alarms, Runs and AI config components with compiled app CSS. No app stack or production.

`*-default.png` shows the initial default layout. Other PNGs follow the min/restored/saved-order interaction checks and are intentionally internally scrolled. `manifest.json` records the producer, limits and the source hashes taken when this evidence was produced (see "What the hashes cover" below for how to read them today).

Red-first: `059f8f3be1e64b18604e1ce790be9db5db22052c`, original source bleed and the ARIA mismatch. `final-layout.log` reports 12 combinations × 8 sizing/text legs, net-off glyph/scroll/neighboring-pixel checks at 120px plus restored 40px text, negative controls and production-net checks. Removing net/wrap/ARIA guards gives the separate mutant failures. Files were restored byte-identical between mutants.

The full suite passed 850 files / 12,117 tests with 1 skip, typecheck 0/0, build passed. Existing Runs, AI menus and compact URN regressions passed. BulkApply initial attempt was interrupted by an author source-edit/Vite reload; unchanged retry passed all 320/390/768/1280 light/dark/cap legs. Independent gate seats provide their own evidence.

## Review fix-cycle evidence

The refreshed screenshots and final-layout.log use the corrected confirmation-cell oracle: the td must contain the Delete question after actions are reordered first. An overflowing nowrap control added to that same td must fail the oracle; removal restores a clean result. The old last-cell check was vacuous (Gabriel FULL BLIND P2); confirmation-cell-red.log records its identity failure at red-first commit 1b3d39606.

Root-rem 200% target checks now supplement the earlier td-only font simulation. rem-red-runs.log and rem-red-alarms.log record the failing ring margins before the bounded fixes (red-first c0afbcad2). Open now uses a fixed 44px target and 140px floor; Alarms Copy uses a 130px floor. The current complete matrix passes at 390/1280, light/dark, including one-line Open and four-pixel ring space at real rem scaling. These remain isolated synthetic components; no OS/browser zoom, production or app-stack claim. Optional review hardening and default Runs width follow-through are in portal#1957.

## Main integration (#1950)

The plain main merge preserves the sticky 170px phone action column and the named configuration Delete question, combining those with opt-in containment and per-kind wrapping. The fixture supplies main's now-required action callbacks. At 390 the action column has no resize handle by design; desktop still exercises its declared minimum/keyboard/drag. The semantic confirmation oracle follows the named question, not a cell position. The refreshed complete matrix and AI row-menu regression pass after integration; seven focused suites pass121tests and typecheck reports0/0. An earlier overlapping Vite run failed a dynamic-module fetch; the serial unchanged run supplies the passing evidence here.

## What the hashes cover

There are two hash sets in `manifest.json`, and they say different things.

- `sourceSHA256` pins the sources as they stood when this evidence and its screenshots were produced (portal#1942). It is a record of what the screenshots show, not a check against today's tree: the script and several components have changed since, so a mismatch with `main` is expected and is not a defect.
- `harnessSHA256AtReview` pins the fixture script, its `scripts/lib` helpers and the fixture harness as they stood when portal#1957 hardened them. Compare these to a later tree to see whether the harness has moved since.

Neither set covers the compiled app CSS or the CI workflow step. The red-first commit is `059f8f3be1e64b18604e1ce790be9db5db22052c`.
