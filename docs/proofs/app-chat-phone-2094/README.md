# portal#2094: Back as a control, readable composer placeholder

Same synthetic fixture as `app-chat-phone-2088`: the real `AgentChat` and the
compiled `app.css` in headless Chromium, inside the app shell of
`src/routes/app/+layout.svelte`, with the chat API answered by
`src/lib/test/fixtures/agent-chat-phone-harness.ts`. No server, provider,
signed-in route or production call.

Regenerate: `AGENT_CHAT_SHOTS=<dir> pnpm test:agent-chat-phone-layout` (the
`baseline-main-*` shots come from running that on `origin/main`).

A subset of what the regenerate command writes:

| File | What it shows |
|---|---|
| `baseline-main-390-light-conversation.png` | main before the fix: Back a bare text link (16px chevron, no border), placeholder hint clipped mid-sentence in the 42px textarea |
| `390-{light,dark}-conversation.png` | Back in a neutral outlined chip (zinc-300/zinc-700, 20px chevron, 44px target); composer floor 104px so the four-line placeholder hint reads whole |
| `320-{light,dark}-conversation.png` | 320px: same control, placeholder whole — here Send wraps under a 220px textarea, so the placeholder wraps differently than at 390 |
| `390-light-list.png` | after Back: the list pane it returns to (unchanged by this fix) |
| `948-light-conversation.png` | panel at `@2xl` and up: two panes, no Back, composer back at its 42px floor (`@2xl:min-h-[42px]` keeps the phone minimum from leaking) |

Limits: component-fixture captures, not the signed-in App page; independent QA
owns the route matrix (320/390, light and dark), and the UX seat owns the
"Back visibly a control" confirmation.
