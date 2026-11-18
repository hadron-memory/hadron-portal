# App list pages (#1758)

Author preview on a disposable Incus stack named `george1758`, API port 18628,
portal port 18629. Server b9a6c4b664ea7d07ad313c2526e9158609fe005a.
Signed in through the dev-only login as the existing synthetic alpha-admin fixture.
Screenshots contain synthetic data only. No provider calls, production writes,
or hosted-production behavior claimed.

The stack was extended with 41 disabled App AI configurations and 41 synthetic
worklog nodes in an adopted team memory. Those database fixtures exercise real
GraphQL reads and the actual signed-in portal, rather than mocked list responses.

Observed: Worklog 1–20, 21–40 and 41–41 of 41, and App config continuation to
21–40 of 41. An open create form removes the config paging links; cancelling
restores them. Light/dark screenshots show each pager at 390px.

UI ground rules: retain the shared TanStack grids; scope search to the served
page; show the server total; use real Previous/Next links with preserved URL
filters. Existing complete-context inventories and capped previews are unchanged.

This is author evidence. Independent portal QA is a separate stamped seat.

Regression evidence: initial loader pins fail 4/5 against the old read strategy;
initial mounted pins fail 2/2 without continuation controls. Seven isolated
mutants are assertion-red (20→200, next/previous requested-size steps, count-race
probe removal, next-link removal, open-form link enablement, navigation-guard
removal), with 11 focused pins restored green. The now-empty config-page copy
pin fails on the old inventory-wide empty claim, then passes with the scoped copy.
