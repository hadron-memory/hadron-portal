# #1956 author harness evidence

2026-11-11 UTC, author George (Codex/OpenAI). Test/tooling slice C only, base main5f1c1e7e9 (contains parent#1950 merge73d6992c). No product behavior change; only unused confirmQuestion removed from production strings; confirmDelete(name) output pinned unchanged.

## Real browser runs

Own fresh disposable Incus stack **george1956**, server main **3ffeca79c**, API14556 / portal15556. Signed in through DEV_LOGIN as the known synthetic alpha-admin@e2e.test; no database user enumeration or saved handoff. Vite dev at this portal source; Chromium headless. No provider calls, production, shared-dev or real credentials.

- Final phone harness: independent coarse/touch mobile context at390 (themes) then320/390 restored saved views; independent fine/no-touch desktop context at1280 (themes and restored500px Actions width). Each context asserts its actual pointer media. Named Delete confirmation+Cancel, keyboard Enter/Escape/focus restoration, explicit ready locators and same-element expansion all pass. Fresh screenshot directory created by the script.
- Row-menu harness: **20** native scenarios,390/1280 × light/dark × disabled/enabled/mixed(two rows)/64-character name. Both horizontal extremes before EACH Edit/Delete, saved middle-column order, content-only opacity, trial+real clicks, named64-character delete wrap and Cancel retained. Desktop is intentionally scrollable; confirmation containment is relative to nearest td[1], not an assertion of whole-table viewport containment or an ancestor-clipping oracle.
- Forced post-create failure: expected exit1 with Injected synthetic probe failure; finally prints Owned synthetic fixture cleanup PASS. A separate signed-in API read afterwards found **zero phone-check- configs**. Unit controls also prove identity-checked409 borrowing never deletes an existing fixture, an unproved/replaced409 refuses before probe, and only a created ID is deleted.

Earlier failed attempts are disclosed: visible SSR Theme/row controls raced hydration; later an SSR width was measured before saved-view restore; waiting for a hidden-on-phone saved-view label as visible also failed. No assertions were removed: readiness now binds a connected Svelte-dev control and its own expanded state; saved-view label waits for attachment and the exact header width is polled then asserted. Desktop can scroll its table into view; phone is measured WITHOUT that accommodation. Final printer-only formatting was checked to have identical parsed AST to the passing phone source. These are author checks, not independent QA or UX.

## Red, green, mutants

Red commit abed5bf1a: **5 assertion failures**, no load failures, on unchanged parent source. Focused helper/Manager suites **133/133** pass. Seven mutants assertion-red then restored: port identity1 failure, unproved409 acceptance2, skipped cleanup2, omitted left edge2, omitted right edge2, omitted before-Edit integration call1, omitted before-Delete integration call1. Full suite/final check details are in the PR validation receipt. Build and svelte-check0errors/0warnings pass; GraphQL unchanged.

## Limits and cleanup

Synthetic fixtures only. Vite-dev readiness uses Svelte client metadata, deliberately not a production-build/public API. Chromium only; no other browsers, screen reader or real provider operation.409 branch is unit-executed; normal native runs use unique names and therefore200 creation. No claim that the screenshot alone proves geometry or pointer modes; browser assertions do.

All browser contexts closed. Stack down succeeded; Incus instance absent. Owned Vite PID was checked by cwd+argv then stopped. Server throwaway worktree removed clean; private stack startup log deleted. Screenshots contain synthetic e2e-alpha, generated fixture names and synthetic key preview only. Recorded findings: hrn:node:hadronmemory.com:hadron-portal:review:browser-wait-binds-activated-element comment1956 (SSR visibility is not hydration readiness).

## Screenshot inventory (SHA256)

- dark-coarse-390.png: `32393ce837204a8287204b64ee378f923cff65df55a1d690bd7a0054ee1eb63e`
- dark-fine-1280.png: `4aff3958451944f64396b9db39ea47871b51778efdd0fb9639d4b9e95825df9c`
- light-coarse-390.png: `21df9ff54b4a819f363633d5463bc19f7e94780c2aeede9517dac67e520353f4`
- light-fine-1280.png: `050e3df0b81ab08c46a59076e011fb8fedf5913f8f88491e98f2030ab8564a49`
