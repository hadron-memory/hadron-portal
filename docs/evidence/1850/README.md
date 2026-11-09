# portal#1850 — Offering section evidence

Real signed-in captures of the Agent page's new Offering section, driven through
the #792 dev login against hadron-server main (offerReadiness per
hadron-server#2246, hrn:node:hadronmemory.com:specs:cor:dmo:050:19). Manager is the signed-in user; the Agent is
`Gloria QA Agent`, flipped PERSONAL→PUBLIC in a throwaway clone of the dev DB to
capture both states. Chromium 1280px, element captures of the section.

| State | Light | Dark |
|---|---|---|
| Not ready (PERSONAL) | [Image](notready-light.png) | [Image](notready-dark.png) |
| Ready (PUBLIC) | [Image](ready-light.png) | [Image](ready-dark.png) |

The not-ready capture shows the AGENT_NOT_PUBLIC reason with a hidden-subject
count line ("1 you can't view" — counts only, never named) and the pointer to
the existing Settings tab. The non-manager case renders no section at all, so it
has no image by definition (acceptance 3); it was verified live with a no-role
reader and is pinned in `offer-readiness.client.test.ts`.
