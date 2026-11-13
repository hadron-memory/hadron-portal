# portal#2088: App agent chat at phone width

Synthetic fixture only: the real `AgentChat` and the compiled `app.css` in headless Chromium, with the chat API answered by `src/lib/test/fixtures/agent-chat-phone-harness.ts`. No server, provider, signed-in route or production call.

Regenerate: `AGENT_CHAT_SHOTS=<dir> pnpm test:agent-chat-phone-layout` (the conversation shots on phones come from the deep-link page, captured last on that page).

| File | What it shows |
|---|---|
| `baseline-main-390-{light,dark}.png` | main `9b6bedbb9`, before the fix: textarea 26px, conversation pane 98px of a 356px panel |
| `390-{light,dark}-list.png` | below `sm`, no chat open or after Back: the list fills the panel |
| `390-{light,dark}-conversation.png` | below `sm`, a chat open: Back ("‹ Chats"), wrapped header, long unbroken text contained, textarea 210px |
| `320-light-conversation.png` | 320px: Send wraps under a 220px textarea |
| `320-dark-refusal.png` | a refused start shown in the list view, wrapped and unclipped |
| `640-light-conversation.png`, `1024-dark-conversation.png` | from `sm` up: today's 256px list beside the conversation, no Back |

Limits: these are component-fixture captures, not the signed-in App page; independent QA owns the route matrix.
