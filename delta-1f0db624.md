# Portal #1649 QA delta: page-cap correction

- Follow-up to base receipt [Cedar QA at c0127a8b](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:hadron-dev-team-shared:sprints:sprint-3:qa:portal-1649:cedar-c0127a8b).
- Task: `01a1a202c1367f31bf1171a1060875cb`.
- Tested portal head: `1f0db624b06e23e931232cadc1992becb0e1f31d`. Exact diff from `c0127a8b38fa73112c74ea3eb78b5b387ae047ef`: four files, 21 insertions, 9 deletions. It adds `MAX_LIMIT = 200` in the shared URL parser and tests the cap, changing the two server loaders that consume that parser. No UI rendering or access-control path changed.
- Backend: hadron-server candidate `2eb466b2af5a0af2eda33b4911d5be8a822fa175`, same as the base receipt.
- Environment: fresh disposable Incus `hadron-e2e-cedar1649delta`, API localhost:18975, portal localhost:18976. 500 synthetic register entries plus a synthetic runnable task. No production/developer data. The stack, browser server, ports, and scratch worktrees were cleaned up.

## Delta checks

1. Exact-head focused test: `pnpm test src/lib/action-register/present.test.ts` — 1 file, 12 tests passed.
2. App register, URL `limit=500`: UI showed 1–200 of 500. Next used `limit=200&offset=200`, then showed 201–400. First two pages contained 400 distinct, consecutive code-sorted rows (`delta.qa.0199` → `delta.qa.0200`); final page held the remaining 100 with no Next link.
3. Definition-route section, URL `limit=500`: first page showed 200 rows marked “Sends work here”; Next advanced by 200 to offset 200 and matched the corresponding GraphQL page.
4. Three direct real GraphQL requests with `limit=500` and offsets 0, 200, 400 returned 200/200/100 rows with `hasMore=true/true/false`. The combined 500 codes were unique and in stable order, with no gaps or duplicates. Browser-rendered boundary rows matched API results.
5. The original 26 browser/API checks and 63 focused tests at `c0127a8b` carry: the new code is confined to clamping an oversized URL limit in the shared parser and its tests; no previously exercised UI structure or authorization path changed. Both placements were independently exercised at the oversized limit in this delta.

## Live state at check

PR #1651 was OPEN, non-draft, at exact head `1f0db624b06e23e931232cadc1992becb0e1f31d`. Eight of nine checks were SUCCESS; CI was still IN_PROGRESS. This is a QA verdict, not a ready/merge call.

## Delta captures

Unmodified PNGs are also in the evidence-only branch. SHA-256:

| Capture | Dimensions | SHA-256 |
|---|---:|---|
| `screenshots/app-register-limit500-page1-1280.png` | 1280×900 | `35df8303dbf7d752110503c009be55abfce7b613ffea25cfec3c8c1bc89d9c46` |
| `screenshots/app-register-limit500-page2-1280.png` | 1280×900 | `300bc2e6c9ffe34968e0aa5fe908e7247d925bad10d2f0bea02be2b52988ff93` |
| `screenshots/definition-limit500-page2-1280.png` | 1280×900 | `2b8546f65e1714bf5a442f36a37453b28c37cc91f9d6fe79f625d7da8130482c` |
