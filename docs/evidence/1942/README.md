# Portal1942 component evidence

Synthetic rows in the real Alarms, Runs and AI config components with compiled app CSS. No app stack or production.

`*-default.png` shows the initial default layout. Other PNGs follow the min/restored/saved-order interaction checks and are intentionally internally scrolled. `manifest.json` records the producer, limits and exact source/artifact hashes; compare source hashes to the reviewed tree.

Red-first: `059f8f3be`, original source bleed and the ARIA mismatch. `final-layout.log` reports 12 combinations ×8 sizing/text legs, net-off glyph/scroll/neighboring-pixel checks at120px plus restored40px text, negative controls and production-net checks. Removing net/wrap/ARIA guards gives the separate mutant failures. Files were restored byte-identical between mutants.

The full suite passed850files/12,117tests with1skip, typecheck0/0, build passed. Existing Runs, AI menus and compactURN regressions passed. BulkApply initial attempt was interrupted by an author source-edit/Vite reload; unchanged retry passed all320/390/768/1280light/dark/cap legs. Independent gate seats provide their own evidence.
