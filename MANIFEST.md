
## Fix head c87ff309 — 390px re-capture (UX P2), 2026-11-01

Uma's UX seat returned a required P2 at 390px: the header row never wrapped and the title block never shrank, so the URN chip's min-content width pushed Reload and Collapse past the viewport edge (both original 390px captures measured 494px document width for a 390px page). Fix commit `c87ff309` (row `flex-wrap` + gaps, title block `min-w-0` so the chip's own truncation engages, button group `shrink-0`, message column `min-w-0`).

Re-run on the same synthetic stack (server `bc70cfa0c` on :4010 over `hadron_gabriel_1525`, portal worktree at `c87ff309` on :5174, dev login as the seed OWNER, Playwright/Chromium 390×844):

- `7-team-fullscreen-light-390-fix.png` / `8-team-fullscreen-dark-390-fix.png` — the same team channel after the fix
- 14/14 assertions PASS, zero console/page errors: document scrollWidth 390 == innerWidth 390 in both themes (was 494); Collapse box x=318 w=32, right edge 350 < 390 in both themes (was x≈383..494); rightmost message-bubble edge 350 (was clipped); caption present; `#1`/`#2` shown, no invented `#0`; no "View node details"; Collapse click lands on `?tab=chat`.

Assertion script kept with the author (scratch, session-local). Branch is evidence-only and must never merge.
