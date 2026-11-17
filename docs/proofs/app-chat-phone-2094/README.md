# portal#2094: Back as a control, readable composer placeholder

Same synthetic fixture as `app-chat-phone-2088`: the real `AgentChat` and the
compiled `app.css` in headless Chromium, inside the app shell of
`src/routes/app/+layout.svelte`, with the chat API answered by
`src/lib/test/fixtures/agent-chat-phone-harness.ts`. No server, provider,
signed-in route or production call.

Regenerate: `AGENT_CHAT_SHOTS=<dir> pnpm test:agent-chat-phone-layout`. The
command writes `-list`, `-conversation` and `-refusal` shots for every width ×
theme leg (320–1440, light and dark; a phone leg's `-conversation` shot is the
deep-link state, captured last on its page). Only the subset below is
committed; the `baseline-main-*` shots come from running the same command on
`origin/main`.

| File | What it shows |
|---|---|
| `baseline-main-390-light-conversation.png` | main before the fix: Back a bare text link (chevron + "Chats", no border); the long placeholder hint clipped mid-sentence in the two-row box |
| `baseline-main-320-light-conversation.png` | main at 320: the same bare Back; the clipped hint wraps to a second line and still doesn't fit, with Send under the box |
| `390-{light,dark}-conversation.png` | the fix: Back a drawn chip (zinc-500 outline on white/zinc-900 — ≥ 3:1 against its surface in both themes — 20px chevron + "Chats" label, 44px target); the placeholder the localized `Message…`; the Enter/Shift+Enter hint moved to helper text under the composer |
| `320-{light,dark}-conversation.png` | 320px: the same chip and composer; the helper line fits, Send still wraps under the textarea (row layout unchanged) |
| `390-light-list.png` | after Back: the list pane it returns to (unchanged by this fix) |
| `948-light-conversation.png` | panel at `@2xl` and up: two panes, no Back, composer at the same natural two-row box (one floor everywhere — nothing leaks across the pane switch) |

The shots run with a desktop pointer, so the helper line shows in them; on
touch pointers it is hidden (`pointer-coarse:hidden`), pinned by the same
script.

Limits: component-fixture captures, not the signed-in App page; independent QA
owns the route matrix (320/390, light and dark), and the UX seat owns the
"Back visibly a control" confirmation. The transcript squeeze on small phones
(header meta + AI row + composer vs the `calc(100dvh − 280px)` panel — 0px
of transcript content at 320×568, and a 20px panel at 320×300) reproduces
identically on main and is tracked as #2201, not absorbed here; on touch
pointers the composer returns to main's exact footprint, and on fine pointers
the helper line is its one deliberate +22px.
