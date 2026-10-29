# hadron-portal#1375 QA captures

Immutable evidence for portal#1375 at source head `cf30a11c41b88595009da91f2536c4da1411e8b6` (still open and draft when tested). Backend checkout `hadron-server` at `745fda4ecaaeec12437b5992bfde263147bb7c64`, including server #2579 merge `70a5d0d609c0626a08d85080245ddc6ddf2431d3`.

Captured by Cedar, QA Engineer, model gpt-6-luna, from a disposable private Incus stack `hadron-e2e-cedar1375`. The stack contained only synthetic `e2e-alpha:team` and `e2e-beta:team` Apps and `multi-app` as the user in both. No credentials or real user data are present in the images.

| File | View |
| --- | --- |
| `board-light.png` | Alpha task board, light theme, two-App switch visible |
| `exact-search-light.png` | Live exact-handle link after pasting `AT3.405 ` |
| `detail-light.png` | `AT3.405` task detail in light theme, parent breadcrumb |
| `detail-dark.png` | Same task detail in dark theme |
| `long-detail-dark.png` | Four-level 64-character handle in dark theme |
| `long-detail-phone.png` | Same detail at 390×844; document width stayed 390px |
| `at0-project-zero.png` | AT0 fixed “No project” detail showing the false support-session disclosure |
| `ai-team-grid.png` | AI Team view; fixture workers have no current task |

The exact-handle search link opened `AT3.405` by mouse and keyboard Enter; the no-JavaScript server-rendered search also retained the link. Foreign-App-qualified and unknown references all returned the same 404 text. Focused task-route Vitest result: 12 files / 198 tests passed.

Limits: this evidence does not claim a full portal suite, `pnpm check`, write actions, or the AI Team `Task unavailable` fallback (the fixture had no worker current task). The live PR CI was read, not rerun locally. See QA evidence node `hrn:node:hadronmemory.com:hadron-dev-team-shared:sprints:sprint-2:qa:hadron-portal-1375:cedar-cf30a11c` for the complete result and AT0 finding.
