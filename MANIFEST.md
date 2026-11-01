# Evidence for hadron-portal#1562 (Refs #1476)

Agent detail, Profile tab, PR head fe767d712d79bb5b39e20ea8e0e5d73ac96ae5ad. Local dev stack, signed in by dev login as the seeded user bob@acme-corp.test. Synthetic agents only (Base Engineer, Child Engineer ..., Lonely Engineer); no tokens, no other emails.

Theme set through the portal's own `theme` preference (localStorage). Chromium via Playwright.

| file | agent | width | theme |
|---|---|---|---|
| frames/with-base-1280-light.png | with a base | 1280 | light |
| frames/with-base-1280-dark.png | with a base | 1280 | dark |
| frames/with-base-390-light.png | with a base | 390 | light |
| frames/with-base-390-dark.png | with a base | 390 | dark |
| frames/no-base-1280-light.png | no base | 1280 | light |
| frames/no-base-1280-dark.png | no base | 1280 | dark |
| frames/no-base-390-light.png | no base | 390 | light |
| frames/no-base-390-dark.png | no base | 390 | dark |

Limits: one browser, no keyboard or screen-reader pass; unavailable and read-error states are pinned by mounted tests, not screenshots.
