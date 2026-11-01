# portal#1525 browser-QA evidence — 2026-11-01

Captured by: Gabriel (portal-engineer), worker `hrn:worker:hadronmemory.com:hadron-dev-team:gabriel`, model GLM/Z.ai (glm-5.3), via Playwright 1.58.2 / Chromium.

Tested heads (frozen):
- Portal: `be40963b` on `feature/1525-team-channel-fullscreen` (10 files, +487/−29; identical tree to `06013c06`, which carried the same change without the Worker trailer)
- Backend: hadron-server `bc70cfa0c` (greta checkout, main)

Synthetic stack scope:
- Disposable PostgreSQL DB `hadron_gabriel_1525` on localhost, built from `prisma migrate deploy` + `pnpm db:seed` (fresh, no production data)
- hadron-server dev on :4010 (`DEV_LOGIN_ENABLED=true`, loopback), portal dev on :5174 (worktree `.env` → `LOCAL_SERVER_URL=http://localhost:4010`)
- Users: mike@mentor-co.test (Client Co OWNER), bob@acme-corp.test, alice@platform-co.test — all seed fixtures
- Team Channel provisioned through the real posting flow (App page → Chats → Team chat → 2 posts → server allocated seqs 1 and 2)

Captures (all of the same team channel, `chats:team` in the Juno @ Client Co app's shared memory):
1. `1-team-node-page-dark-1280.png` — node page, Chat tab, icon-only full-screen entry (aria-label "Open full-screen channel"), inline thread WITHOUT seqs
2. `2-team-fullscreen-dark-1280.png` — full screen: caption "Juno @ Client Co - Team Channel", per-message #1/#2, icon-only Collapse, no "View node details", no App URN line
3. `3-team-node-page-light-1280.png` — same as 1, light
4. `4-team-fullscreen-light-1280.png` — same as 2, light
5. `5-team-fullscreen-light-390.png` — 390px mobile, light
6. `6-team-fullscreen-dark-390.png` — 390px mobile, dark

Assertion log (17/17 PASS, zero console/page errors): qa3-team-assert.mjs — entry exists/aria-label/no-text-label/title-attr; URL route; document title; caption; no View-node-details; no App line; #1 and #2 shown; no invented #0; collapse exists/aria-label; breadcrumb "Channel"; collapse returns to `?tab=chat`; inline thread shows posted message.

Missing states (recorded, not waived): the non-team (agent-chat) browser contrast could not be captured in this stack — the seeded AI service configs carry no API key, so the agent-chat composer renders its no-llm-config state and no non-team chat node is reachable through the UI. The non-team wording is covered by the branch's loader/SSR/client test matrix (chat/page.server.test.ts, team-channel-header.client.test.ts, fullscreen-entry.client.test.ts).

Cleanup: the disposable DB and both dev servers are session-local and will be dropped/stopped after the QA seat; this branch is evidence-only and must never merge.
