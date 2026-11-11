# Portal1942 component evidence

Synthetic rows in the real Alarms, Runs and AI config components with compiled app CSS. No app stack or production.

`*-default.png` shows the initial default layout. Other PNGs follow the min/restored/saved-order interaction checks and are intentionally internally scrolled. `manifest.json` records the producer, limits and exact source/artifact hashes; compare source hashes to the reviewed tree.

Red-first: `059f8f3be`, original source bleed and the ARIA mismatch. `final-layout.log` reports 12 combinations ×8 sizing/text legs, net-off glyph/scroll/neighboring-pixel checks at120px plus restored40px text, negative controls and production-net checks. Removing net/wrap/ARIA guards gives the separate mutant failures. Files were restored byte-identical between mutants.

The full suite passed850files/12,117tests with1skip, typecheck0/0, build passed. Existing Runs, AI menus and compactURN regressions passed. BulkApply initial attempt was interrupted by an author source-edit/Vite reload; unchanged retry passed all320/390/768/1280light/dark/cap legs. Independent gate seats provide their own evidence.

## Review fix-cycle evidence

The refreshed screenshots and final-layout.log use the corrected confirmation-cell oracle: the td must contain the Delete question after actions are reordered first. An overflowing nowrap control added to that same td must fail the oracle; removal restores a clean result. The old last-cell check was vacuous (Gabriel FULL BLIND P2); confirmation-cell-red.log records its identity failure at red-first commit 1b3d39606.

Root-rem 200% target checks now supplement the earlier td-only font simulation. rem-red-runs.log and rem-red-alarms.log record the failing ring margins before the bounded fixes (red-first c0afbcad2). Open now uses a fixed 44px target and 140px floor; Alarms Copy uses a 130px floor. The current complete matrix passes at 390/1280, light/dark, including one-line Open and four-pixel ring space at real rem scaling. These remain isolated synthetic components; no OS/browser zoom, production or app-stack claim. Optional review hardening and default Runs width follow-through are in portal#1957.
