# Invite Copy hover contrast (#1557)

Author evidence from the real hydrated Invite component mounted by
`src/lib/test/fixtures/invite-copy-harness.ts`, with the synthetic successful
action and form seam from `scripts/test-invite-copy.mjs`. No account/backend
journey, invitation creation, provider call, email, OS clipboard permission or
production write is claimed.

Screenshots show the Copy hover state at 1280px and 390px in light and dark
themes. The four views were inspected. The patch changes only the light text
token from `text-green-700` to `text-green-800`; dark tokens and layout are
unchanged.

Rendered computed colors use the installed Tailwind OKLCH palette:

| Theme | Text | Hover background | Contrast |
|---|---|---|---|
| Light | `oklch(0.448 0.119 151.328)` (green-800) | `oklch(0.962 0.044 156.743)` (green-100) | **6.453174:1** |
| Dark | `oklch(0.871 0.15 154.449)` (green-300) | `oklch(0.393 0.095 152.535)` (green-900) | **6.488296:1** |

Contrast uses the gate's OKLCH-to-linear-sRGB conversion with linear channels
clamped to the displayable gamut. The old light pair measured **4.496727:1** in
the issue gate. Transitions were disabled before reading computed style, per
`hrn:node:hadronmemory.com:hadron-portal:findings:frozen-transition-fakes-wrong-theme-color`.

The focused token pin failed against the old green-700 class before the fix and
passes afterward. At the final main-merged head, the token file passes 4/4 and
all 24 real-component Invite clipboard browser cases pass at 390px and 1280px
in light and dark.

UI ground rules 1–6: pass for this scoped token-only diff. The user wants to
copy an invite with readable hover text. Existing control, copy, structure and
form behavior are reused; no new list, picker, entity reference, heading,
action or feedback pattern was introduced.
