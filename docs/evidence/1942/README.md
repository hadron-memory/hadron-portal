# Portal #1942 component evidence

Synthetic rows in the real Alarms, Runs and AI config components with compiled app CSS. No app stack or production.

`*-default.png` shows the initial default layout. Other PNGs follow the min/restored/saved-order interaction checks and are intentionally internally scrolled. `manifest.json` records the producer, limits and exact source/artifact hashes; compare source hashes to the reviewed tree.

Red-first: `059f8f3be1e64b18604e1ce790be9db5db22052c`, original source bleed and the ARIA mismatch. `final-layout.log` reports 12 combinations × 8 sizing/text legs, net-off glyph/scroll/neighboring-pixel checks at 120px plus restored40px text, negative controls and production-net checks. Removing net/wrap/ARIA guards gives the separate mutant failures. Files were restored byte-identical between mutants.

The full suite passed 850 files / 12,117 tests with 1 skip, typecheck 0/0, build passed. Existing Runs, AI menus and compactURN regressions passed. BulkApply initial attempt was interrupted by an author source-edit/Vite reload; unchanged retry passed all 320/390/768/1280 light/dark/cap legs. Independent gate seats provide their own evidence.

## Review fix-cycle evidence

The refreshed screenshots and final-layout.log use the corrected confirmation-cell oracle: the td must contain the Delete question after actions are reordered first. An overflowing nowrap control added to that same td must fail the oracle; removal restores a clean result. The old last-cell check was vacuous (Gabriel FULL BLIND P2); confirmation-cell-red.log records its identity failure at red-first commit 1b3d39606.

Root-rem 200% target checks now supplement the earlier td-only font simulation. rem-red-runs.log and rem-red-alarms.log record the failing ring margins before the bounded fixes (red-first c0afbcad2). Open now uses a fixed 44px target and 140px floor; Alarms Copy uses a 130px floor. The current complete matrix passes at 390/1280, light/dark, including one-line Open and four-pixel ring space at real rem scaling. These remain isolated synthetic components; no OS/browser zoom, production or app-stack claim. Optional review hardening and default Runs width follow-through are in portal#1957.

## Main integration (#1950)

The plain main merge preserves the sticky 170px phone action column and the named configuration Delete question, combining those with opt-in containment and per-kind wrapping. The fixture supplies main's now-required action callbacks. At 390 the action column has no resize handle by design; desktop still exercises its declared minimum/keyboard/drag. The semantic confirmation oracle follows the named question, not a cell position. The refreshed complete matrix and AI row-menu regression pass after integration; seven focused suites pass121tests and typecheck reports0/0. An earlier overlapping Vite run failed a dynamic-module fetch; the serial unchanged run supplies the passing evidence here.

## What the hashes cover (portal#1957)

`manifest.json` hashes the files listed in `sourceSHA256`, as they stood when this evidence was produced. It does not cover the helper modules the script imports from `scripts/lib/` (`cell-harness-env.mjs`, `cell-harness-checks.mjs`, `cell-harness-messages.mjs`), the CI workflow step, or the app CSS the fixture compiles. A matching hash therefore shows the listed component and harness sources are unchanged; it does not show the whole run is reproducible. Those helpers were added after this evidence, so no hash for them could honestly be recorded from the time it was produced. The red-first commit is cited by its full SHA throughout.
