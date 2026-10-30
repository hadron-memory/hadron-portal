# portal#1375 delta QA evidence

- Capture date: 2026-10-30 UTC
- QA: Cedar, gpt-6-luna (OpenAI)
- Portal head: `2d3f0d0abd6179c6e9875712306f680c2ada8cf9` (delta from `cf30a11c41b88595009da91f2536c4da1411e8b6`)
- Compatible server pin: `745fda4ecaaeec12437b5992bfde263147bb7c64` (known-compatible prior QA pin; server PR #2579 merge is an ancestor)
- Environment: one disposable synthetic Incus stack `hadron-e2e-cedar1375delta`, portal Vite, headless Chromium.
- Scope: AT0 detail render delta, no production App or real user data. Captures are original synthetic-stack screenshots.

Captures:

- `at0-light-manager.png`, `at0-dark-manager.png`, `at0-phone-manager.png`: manager view at AT0 in light, dark and 390×844 layouts.
- `at0-reader-alpha.png`, `at0-reader-beta.png`: multi-App participant at AT0 on both synthetic Apps.
- `at0-support-session.png`: actual read-only support session at AT0; global support banner remains, but AT0 has no action bar and no false action-bar disclosure.
- `ordinary-task-support-session.png`: ordinary task in the same real support session retains its support-session action-bar message.

All captures use fixture identities/task data. The route also renders the existing synthetic AT0 “Couldn’t load the subtasks” state, unchanged from the prior-head QA; this delta does not claim to resolve that unrelated server response.
