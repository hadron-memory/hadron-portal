# Agent chat transcript height (#2201)

Author: George (Codex/OpenAI), 2026-11-17. Portal base `7a9ed30bb06cff8e229a6731535070b5ff67c97d`.

The real route gives its Agent chat wrapper a 544px minimum height below 948px viewport width (the default shell’s narrow-pane range). Its existing
`100dvh - 280px` / `100vh - 280px` height remains. Nothing is hidden, collapsed or re-parented;
short pages scroll as documents, with no added scroll container. The composer stays 58px.

## Evidence

Red first: `node scripts/test-agent-chat-transcript-height.mjs` on the base fails at
320x568/light/fine with 0px transcript content. The probe reads the route's actual wrapper,
mounts real AgentChat with compiled CSS, and models both the app-shell nav and its mobile
menu opener. The latter consumes 34px + 16px gap: omitting it overstates chat width by 50px.

Initial-head author signed-in matrix (ea9fee524, retained as historical evidence): private disposable Incus stack `george2201`, server
`8f678b45b`, synthetic `alpha-admin@e2e.test` and App `e2e-alpha:team`. Dev-login remained
inside Chromium. A synthetic enabled AI config permits the chat view; no provider call is
made. `/api/agent-chat/list` and `/resume` return one chat and two short messages;
served-prompt records are empty. Theme selected through the real Theme menu.

All 16 legs pass (light/dark × fine/coarse at each size):

| Viewport | Panel | Scroller | Content | Latest fully inside transcript above composer |
| --- | ---: | ---: | ---: | --- |
| 320x568 | 544 | 192 | 160 | yes |
| 360x640 | 544 | 247 | 215 | yes |
| 390x844 | 564 | 282 | 250 | yes |
| 948x900 | 620 | 397 | 365 | yes |

The issue's historic desktop 362/330 measurement uses different fixture metadata.
This fixture's desktop 397/365 is identical with the floor explicitly disabled;
the panel stays 620. The probe compares these same-fixture desktop measurements instead
of mistaking a different fixture's fixed pixel table for a layout regression.
390 content clears the issue's 181px lower bound. Every leg has no horizontal overflow,
no scrolling ancestor around the transcript other than the document, and a 58px textarea.
Browser page/console/request diagnostics were checked. Raw measurements: [results.json](results.json).
Screenshots below are from the signed-in route with synthetic data, not a component mock.

| Width | Light | Dark |
| --- | --- | --- |
| 320 | [Screenshot](320x568-light-fine.png) | [Screenshot](320x568-dark-fine.png) |
| 360 | [Screenshot](360x640-light-fine.png) | [Screenshot](360x640-dark-fine.png) |
| 390 | [Screenshot](390x844-light-fine.png) | [Screenshot](390x844-dark-fine.png) |
| 948 | [Screenshot](948x900-light-fine.png) | [Screenshot](948x900-dark-fine.png) |

## Limits / sequencing

Chromium only, no landscape, virtual keyboard, provider turn or real user data. This is author
evidence, not the independent QA seat. #2171 remains open at measurement time; its fine-pointer
hint adds height to the composer block. The 544px floor leaves margin for that hint, but the
issue explicitly requires re-measurement after #2171 merges. Readiness must retain that dependency.


## Fix round after review

Peter’s scope ruling (team chat #111914): retain the floor only in the narrow
layout, leaving short desktops as on main. The route now uses
`max-[948px]:min-h-[544px]`: 948px is where the default app shell’s chat reaches
its existing 672px / `@2xl` two-pane switch. No new container is introduced, so
fixed overlays do not acquire a different containing block.

The committed probe now runs **24 legs**: the original four sizes plus 1366x657
(short desktop) and 320x460 (reduced visible phone height), both themes and pointer
modes. It asserts the actual coarse/fine media queries; scrolls the document to
the textarea; then checks the message and textarea against `innerHeight`, not
only their parent boxes. It rejects additional scrolling ancestors. The 390,
948 and short-desktop cases compare against the exact same fixture with the floor
disabled. One message-ancestor lookup is used for both measurements.

Red-first fix-round test: under the old unscoped floor, 1366x657 measures panel544 /
scroller338, versus main’s panel377 / scroller171, and the equality assertion fails.
With the narrowed floor all24 legs pass. The short desktop remains panel377 /
scroller171 / content139; the reduced-height phone keeps content160 and its textarea
bottom is exactly the460px viewport bottom after the document scroll. The original
four size measurements remain160/215/250/365px of content. These are component-probe
results; independent QA must revalidate the fix head, and #2171 still gates the
post-merge re-measurement.

- [24-leg component-probe results](fix-round/probe-results.json)
- Short desktop viewport: [Light](fix-round/1366x657-light-fine-viewport.png), [Dark](fix-round/1366x657-dark-fine-viewport.png)
- Reduced phone viewport: [Light](fix-round/320x460-light-fine-viewport.png), [Dark](fix-round/320x460-dark-fine-viewport.png)

The original results.json is explicitly the signed-in author driver’s output,
not the component probe’s output. Both are labelled here; the added nested-scroll
and viewport checks are now executable in the committed component probe as well.
Physical browser toolbars, Safari and virtual keyboards remain untested.
