# API-key Hide focus recovery — author evidence

The user wants to hide a revoked API key and continue keyboard navigation from a usable control. This reuses the existing key grid, row menu, Show hidden keys toggle and persistent feedback regions. No copy, layout, authorization or provider behavior changes.

Author: Greta, Codex/OpenAI (exact model identifier unverified).

Built portal source: red-first commit `7020193c` plus the two-file focus fix in this PR. Private synthetic server: `c5265d936326a52612ef8d5cd021b8fc1eab8ba8`; Chromium `145.0.7632.6`, Playwright `1.58.2`. Existing local dependencies, no host installs. Real server GraphQL and portal actions, a new isolated database, synthetic CONTRIBUTOR and synthetic API key; session token passed in memory. No production, real credentials or provider calls. Database, processes and browser torn down after each attempt.

The final run uses the real Theme menu and asserts the actual theme, then native keyboard Enter on the row menu and Hide/Unhide. It records the framework's BODY focus reset, waits for the checkbox to own focus, and verifies it survives two animation frames. This is an ordering checkpoint, not a sleep-only assertion. Each theme/width covers default-view row removal, Show hidden mode, and repeated Unhide/Hide/Unhide. No-JS Hide and Unhide succeed and keep their feedback. Results: [results.json](results.json).

| Viewport | Light | Dark |
| --- | --- | --- |
| 1280px | [Hide complete](hide-light-1280.png) | [Hide complete](hide-dark-1280.png) |
| 390px | [Hide complete](hide-light-390.png) | [Hide complete](hide-dark-390.png) |

The captures contain no raw key reveal. Ground rules 1–6: pass; controls and layout are reused, with focus shown on the persistent toggle.

## Limits

This is the author's check; independent native QA is still required. Refusal and deliberate-navigation/focus behavior are mounted-tested, not native-driven in this author run. No spoken assistive-technology claim. Earlier fixture setup attempts failed before serving until the private environment included the current server's required ephemeral rate-limit keyring; earlier harness captures used an obsolete theme selector and were discarded. The final run above passes with the current Theme menu, actual theme assertion and explicit includeHidden URL checkpoints.
