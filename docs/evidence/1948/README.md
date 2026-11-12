# Portal1948 author UI evidence

Actual signed-in App AI Team grid and worker Profile, local Vite dev server, Chromium1280x1000, light/dark selected through the real Theme menu. All records are disposable synthetic fixtures (alpha-owner@e2e.test, e2e-alpha team, Test Coordinator/Test Reviewer), never production data.

Server: hadron-server9d46e2258cfa2b2a2cdb81c75f2eca7493141127, fresh Incus stack george1948 (API14948, portal15948). Portal based on73d6992c1 with the accompanying1948 source changes. Two fixture terminal reports set to8 hours old (Idle and Dark/bare_shell) using SQL only in this disposable DB. Grid shows two Stale cells with age, no stored status/reason, and one all-stale note. Worker Profile shows Stale with its age. Host label/prompt are not rendered.

Files: grid-light-1280.png, grid-dark-1280.png, worker-light-1280.png, worker-dark-1280.png. Theme menu interaction proves hydration; both image variants were visually inspected. A separate browser control makes one report fresh (3 minutes): note disappears, remaining row Stale, fresh row Idle with age. Stale threshold/future/missing-time and clock-driven transitions are also pinned in unit/client tests.

Local setup correction: initial symlinked node_modules was outside Vite's fs.allow, which blocked the SvelteKit client entry even while SSR rendered. That attempt was not accepted as browser-flow evidence; these images were replaced after a scoped launch-only allow-list fix and real hydrated Theme interaction. Captured in hrn:node:hadronmemory.com:hadron-portal:findings:symlinked-deps-can-block-client-hydration.

Limits: author verification, not independent QA; dev server, no screen reader/mobile run, no production/provider calls. Frozen-head LOCAL/BLIND/browser QA/UX wording seats remain required by CHECKED6791624528. No product/source change to Vite config. Disposable stack, browser contexts and Vite stopped; fixture DB destroyed. No tokens/handoff codes in these artifacts.
