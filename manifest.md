# Portal #1649 independent QA evidence

- Task: `01a1a202c1367f31bf1171a1060875cb` (Cedar, QA)
- QA execution: 2026-11-03 UTC, Cedar's bound Codex/OpenAI session; the session interface does not expose a more specific runtime model identifier.
- Portal PR: [#1651](https://github.com/hadron-memory/hadron-portal/pull/1651), exact tested head `c0127a8b38fa73112c74ea3eb78b5b387ae047ef`.
- Private backend candidate: hadron-server `origin/main` `2eb466b2af5a0af2eda33b4911d5be8a822fa175`, a descendant of gate prerequisite `956f86ae`.
- Environment: fresh disposable Incus stack `hadron-e2e-cedar1649`; API on localhost:18965 and portal on localhost:18966. Chromium headless browser. All fixture data was synthetic; no production or developer data was used.
- Browser fixture: synthetic Alpha and Beta Apps, explicit asking Agents, an inherited BaseAgent definition, 25 register entries including MAPPED, UNRESOLVED, and UNMAPPED results, and an ambiguous Team Agent in Beta.
- Peer exposure: before saving this evidence, I read Gemma's browser-capture list node `hrn:node:hadronmemory.com:hadron-dev-team-shared:sprints:sprint-3:evidence:portal-1649:gemma-browser-captures` revision 4. I did not use Gemma's captures or results. My stack, fixture, API calls, browser run, and screenshots were independently produced.

## Results

1. Focused exact-head suite: 7 files, 63 tests passed.
2. App register: no-Agent state makes no empty-index claim; chooser opens, closes on Escape, and keyboard search/select sets an explicit Agent. The selected Agent is named. Server-driven 20/25 paging works; the second page includes mapped, unresolved, and unmapped rows with the expected explanatory text. Unmapped entries are not linked.
3. GraphQL `actionRegisterIndex`: page one returns 20/25 and `hasMore=true`; page two returns five and `hasMore=false`. MAPPED has a task URN; UNRESOLVED preserves `tasks:stalled` with no task URN; UNMAPPED returns null target/entry fields. A filtered inherited-definition query returns 22 results across pages 20+2.
4. Definition route: the selected App and route Agent are retained, inherited task rows are marked “Sends work here,” and filtered paging returns 20+2. The BaseAgent definition route remains valid and shows the register-unavailable section.
5. Ambiguous Team Agent: UI gives the neutral empty state (“No codes shown”, “0 in all”) with no diagnostic; API gives an empty, successful result. Foreign-App access is refused in the browser and returns uniform `APP_NOT_FOUND` through GraphQL. A readable but uninstalled BaseAgent and an unknown Agent both return `AGENT_NOT_FOUND`.
6. Responsive/theme review: captures include desktop and 390px mobile views in light/dark preferences. On mobile, the table is in a horizontally scrollable container (measured `scrollWidth` 780px, `clientWidth` 306px).
7. Live PR check before receipt: OPEN, non-draft, exact head unchanged, CLEAN, CI 9/9 success.

## Limits and cleanup

- Synthetic fixture and private candidate server only; no deployed-provider or production behavior is claimed.
- The PR's stated “cast worker without Agent installation” option enumeration limit remains an author-disclosed limit; this QA did not broaden it.
- The server/backend candidate is not claimed as deployed; the task's landing/deployment hold remains outside this QA seat.
- The private stack and Vite server were stopped after evidence capture; temporary stack credentials/logs and scratch checkouts were removed. Only the evidence-only branch remains.

## Captures

Original PNGs are stored unchanged under `screenshots/`. SHA-256:

| Capture | Dimensions | SHA-256 |
|---|---:|---|
| `app-register-ambiguous-empty-1280-light.png` | 1280×900 | `3da4eb09e6682e81db5f7eb2c8f7cd6f2572d83964accbd85009e3b67f10844b` |
| `app-register-page1-1280-light.png` | 1280×900 | `b05c73c39fbd9fe63d79efa399faed8349756e1bcb09bf8b3667edc36b54b101` |
| `app-register-page2-1280-light.png` | 1280×900 | `aea92a757ed66f37e9618538f2ca9ee8307f29e8e15ffb475c40b34aa607a8d5` |
| `app-register-page2-390-dark.png` | 390×844 | `52854b2f0b02201647f3679a15c48ddc9c674674f8742c95b6fc276b39459f10` |
| `app-register-page2-390-light.png` | 390×844 | `e0d9173042f5b071d52445b46c38a55449cb87f562bb794131f0ef55a82a371d` |
| `definition-base-unavailable-1280-dark.png` | 1280×900 | `26d6c714c69c731ffe3bd2f844b6b4562fec9ff97bce863d2104a4ca0d20216b` |
| `definition-inherited-1280-light.png` | 1280×1144 | `cdc09326fcb64a3e8f09e544dc37f017d6848a3923d7529ad048620aec2c4288` |
| `definition-inherited-page2-390-dark.png` | 390×970 | `23975f4ef93eaf75391308604e11b61b19c8a2dc31b658e0992e27595624a36e` |
| `definition-inherited-page2-390-light.png` | 390×970 | `2fba4277a77c2e8f693089c7a07a7b0e173f1274e0f1eb47767bf682c5f9d3ba` |

No tokens, passwords, or real user data are present in the captures.
