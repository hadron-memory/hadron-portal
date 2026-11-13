# portal#1846 slice B — author UI evidence

Captured 2026-11-10 with Playwright/Chromium against the portal worktree and a
fresh disposable Incus E2E stack (`greer-1846`, API 18461, portal 18561).
Server revision: `be731afddfabdf406a0aec2903e80ace0615a7be` (current
`origin/main` when the stack was created). Synthetic users and organizations
only; no production or canonical development database was used. This is author
verification, not the independent QA seat.

## Exercised

- Member `/app/u/hrn:org:e2e-alpha` kept `/app/orgs/[id]`.
- Signed-in non-member `/app/u/hrn:org:e2e-alpha` reached `/app/org/[id]`.
- Memory Info owner URN opened the public profile; public memory and Agent
  name links opened their resources.
- Missing and non-discoverable direct profiles both rendered
  `Organization not found`; a non-discoverable org URN did not reach a profile.
- Empty marketplace-listed organization showed both zero-count sections and
  their empty copy.
- Anonymous `/app/org/[id]?from=memory` retained the existing sign-in redirect
  and deep-link state.
- Every screenshot was asserted to have no document or table horizontal
  overflow. The first 390px run found a 340px table in a 306px scroller; the
  final tables use 220px default columns and also pass at 320px in both themes.
  Descriptions wrap in full rather than truncating without a reading affordance.
- Loading is covered by the existing `NavigationFeedback` client test. Load
  failure and Retry have route SSR/client tests, including a rejected retry
  with no unhandled rejection and a resolved retry that lands on the same error
  page; no load-error screenshot is claimed.

## Screenshot matrix

Each state has four captures: `1280-dark`, `1280-light`, `390-dark`, and
`390-light`.

- `populated-*`: one public memory and one public Agent.
- `empty-*`: zero public memories and Agents, marketplace-listed.
- `not-found-*`: missing organization.

UI ground rules 1–6: **pass**. One h1 names the organization, its URN is
immediately below, each resource list is a shared DataTable with a unique
org-scoped `listKey`, and no member/admin controls or fields beyond
`PublicOrganization` appear.
