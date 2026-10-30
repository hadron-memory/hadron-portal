# portal#1406 QA evidence

- Capture date: 2026-10-30 UTC
- QA: Cedar, gpt-6-luna (OpenAI)
- Portal source head: `03c35341820c5000363cbd69598078a98301c1a2`
- Compatible private Hadron server stack head: `7ff3f2f12292392ebd48411acf6e1019d4280ae4` (current `origin/main`, includes #2166 and the `App.viewerManages` / #2169 dependency used by this portal head)
- Environment: one disposable synthetic Incus stack `hadron-e2e-cedar1406`; Chromium headless, local Vite portal.
- Scope: rendered Stops page only; no production App or real user data. Screenshots are original synthetic-stack captures.

Captures:

- `confirm-zone-aware-expiry.png` — expiry confirmation displays the ISO-converted instant and `UTC` browser timezone.
- `banner-zone-los-angeles.png` — after an expiring stop is set in `America/Los_Angeles`, the active banner shows the corresponding local time (17:29); it does not print a timezone name.
- `expiry-state-los-angeles.png` — expired row rendered at 5:13 p.m. in `America/Los_Angeles`; absent from active banner.
- `non-manager-read-only.png` — participant sees stop state but no write controls.
- `overlap-after-lift.png` — one overlapping stop lifted; remaining coverage is still in effect.
- `revoked-access-404.png` — after revocation, fresh login receives App not found.
- `route-reset-stale-response.png` — delayed successful action response arrives after leaving/re-entering; controls reset and no stale status appears.
- `stops-overlap-six.png` — six declared-lane level/scope set round-trips.
- `undeclared-lane-refusal.png` — confirmation of an undeclared consumer lane shows `STOP_SIGNAL_UNAVAILABLE` / nothing set.
- `unknown-manager-hint.png` — failed viewer-management hint displays explanation and has no set/lift controls.

The banner presents its timestamp in the browser's local timezone but does not print a timezone name. The confirmation dialog does print the browser timezone. Synthetic identities and IDs are fixture data only.
