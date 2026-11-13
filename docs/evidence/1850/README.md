# portal#1850 — Offering section evidence

Author's signed-in captures of the section (element shots, Chromium 1280px), driven through the #792 dev login against hadron-server main with `offerReadiness` (hadron-server#2246). Manager is the signed-in user; the Agent is `Gloria QA Agent` from the synthetic seed (`alice@platform-co.test`), flipped PERSONAL→PUBLIC in a throwaway clone of the dev DB to capture both states. Independent verification is the seat reviewers' own runs, not these captures.

| State | Light | Dark |
|---|---|---|
| Not ready (PERSONAL) | [Image](notready-light.png) | [Image](notready-dark.png) |
| Ready (PUBLIC) | [Image](ready-light.png) | [Image](ready-dark.png) |

The not-ready capture shows the AGENT_NOT_PUBLIC reason with a hidden-subject count line (counts only, never named) and the pointer to the existing Settings tab. The non-manager case renders no section at all, so it has no image by definition (acceptance 3); the author verified it live with a no-role reader and it is pinned in `offer-readiness.client.test.ts`.

Spec: `hrn:node:hadronmemory.com:specs:cor:dmo:050:19`.
