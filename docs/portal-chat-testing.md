# Portal Agent Chat — Manual Test Checklist

End-to-end smoke test for the per-agent Chat tab on the agent detail page.
Exercises the full loop: AI config → conversation design → chat turns → stage
transitions → chat management.

This is a manual checklist, not an automated suite. Run through it after any
change to agent chat, the Chat API, or the conversation engine.

## Prerequisites

- An organization you are an **admin** of.
- An agent with:
  - A **chatbot system memory** attached (role `read-write`).
  - At least one **non-setup conversation** defined under `conversations:*`
    with a real starting stage and prompt. A setup-only system memory will
    hide the Chat tab.
- An API key for one of: Anthropic, OpenAI, or GLM.

## 1. AI config (Settings tab)

1. Open the agent detail page → **Settings** tab.
2. Confirm the **AI configuration** section shows "No AI config yet" when
   `hasAiApiKey` is false.
3. Click **Edit** → pick a provider, enter a model, paste an API key.
4. **Save** → row refreshes, `hasAiApiKey` flips to true, provider/model
   shown, key is masked.
5. **Test** → expect `✓ Works` with a one-sentence reply from the model.
6. Enter a bad key → **Save** → **Test** → expect a clear provider error
   message, not a stack trace.
7. **Clear** → confirmation → config is removed, Chat tab disappears.

## 2. Chat tab visibility gate

The Chat tab should appear **only** when all three are true:

- `hasSystemMemory` (agent has a chatbot system memory)
- `hasAiApiKey` (AI config saved)
- `hasNonSetupConversations` (at least one `conversations:<name>` node with
  `isSetup !== true`)

Toggle each condition off individually and verify the tab hides.

## 3. Start a new chat

1. Open the **Chat** tab. Sidebar shows "No chats yet".
2. Click **New chat**.
3. Expect:
   - A new chat row appears in the sidebar, selected.
   - The assistant greets you with the conversation's welcome prompt
     (served by `/api/agent-chat/start`).
   - No user bubble precedes the welcome.
   - Stage toast shows the initial stage, if the conversation defines one.

## 4. Send messages

1. Type a message → **Enter** (or click Send).
2. User bubble appears immediately (optimistic).
3. Assistant reply streams in once the LLM responds.
4. On error (kill network, wrong key), the optimistic user bubble rolls
   back and `turnError` is shown below the input.
5. Shift+Enter inserts a newline; Enter alone submits.

## 5. Stage transitions

1. Drive the conversation through a prompt designed to transition stages
   (e.g., answer the question the stage is gating on).
2. Expect a **stage toast** when `next_stage` is returned.
3. Subsequent assistant messages should reflect the new stage's prompt.

## 6. Resume an existing chat

1. Start a second chat so there are at least two in the sidebar.
2. Reload the page.
3. Open the Chat tab → sidebar lists both chats, sorted by
   `lastMessageAt` (most recent first).
4. Click an older chat → messages load via `/api/agent-chat/resume`.
5. Send another message → `lastMessageAt` updates and the row jumps to
   the top of the sidebar.

## 7. Rename + delete

1. Hover a chat row → click rename → edit title → **Enter** to commit,
   **Escape** to cancel.
2. Click delete → confirmation modal → confirm → chat disappears from
   sidebar, underlying `Chat` is soft-deleted.
3. Cancel on the modal keeps the chat.

## 8. Per-user scoping

1. As user A, create a chat in agent X.
2. Log in as user B (same org, same agent) → Chat tab.
3. Expect an **empty sidebar** — user A's chats must not leak.
4. Starting a chat as B provisions a fresh per-user memory
   (`userMemoryOfAgentId`) and does not touch A's memory.

## 9. Multi-provider sanity

Run sections 3–5 once per provider you support:

- Anthropic (`claude-*`)
- OpenAI (`gpt-*`)
- GLM (`glm-*`)

Tool-call forcing must succeed for all three — the LLM should always call
`respond({ message, data, next_stage })`, never return plain text. If a
provider returns text, treat it as a bug in `agentChatLlm.ts`.

## 10. Welcome latency

The welcome message is served synchronously by `/api/agent-chat/start`,
which runs a full LLM turn before returning. Expect a 1–3s delay on New
chat. This is known; streaming is not yet implemented.

## Known non-goals (do not test)

- Password-based encryption of API keys (deferred; JWT only for now).
- Streaming responses.
- Station chat retirement — legacy station chat is untouched.
- Billing / usage metering for agent chat turns.
