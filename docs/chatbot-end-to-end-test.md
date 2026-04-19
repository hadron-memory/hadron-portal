# Chatbot Agent End-to-End Test

A step-by-step guide that builds an agent, designs conversations, runs
chats as test personas, and verifies that everything landed correctly in
memory. Follow every step — the expected results at the end are specific
and testable.

## What you will build

By the end of this test you will have:

- **1 agent** ("Sage") with a system memory and a knowledge memory.
- **2 conversations**: `onboarding` (learn about the user) and
  `strategy` (help with a business problem).
- **3+ stages per conversation**, each with an `extractionSpec` that
  pulls structured data from the chat.
- **2 personas** (Alex Chen and Maria Santos), each with their own
  per-user memory created automatically on first chat.
- **Chat transcripts** stored in each persona's memory, including
  message history, extracted data, summaries, and stage transitions.

## What you need

- A Hadron portal account at [hadronmemory.com](https://hadronmemory.com)
  with **admin** access to an organization.
- An API key for one of: Anthropic, OpenAI, or GLM.
- Claude Code installed with the Hadron MCP server connected (for
  building the conversation designs). See
  [testing-a-chatbot-in-claude-code.md](./testing-a-chatbot-in-claude-code.md)
  for station setup.

---

## Part 1 — Create the agent (Portal)

1. Go to your org page → **Create Chatbot Agent**.
2. Fill in:
   - **Agent name**: `Sage`
   - **Description**: `AI mentor for small business owners`
   - **Visibility**: Private
3. On the System Prompt step, enter:
   ```
   You are Sage, a warm and practical AI mentor for small business
   owners. You ask clarifying questions before giving advice. You are
   direct but encouraging. When you don't know something, say so.
   ```
4. On the Memories step:
   - System memory: auto-named `Sage System` (URN: `sage-system`) —
     leave as-is.
   - Knowledge memory: keep it checked. Auto-named `Sage Knowledge`
     (URN: `sage-knowledge`).
5. Review and create.

**Checkpoint**: On the agent detail page you should see:
- Agent "Sage" with system memory set.
- Two memories listed: `Sage Knowledge` (read-write).
- The Chatbot Control tab showing one conversation (`setup`) with one
  stage (`onboard`).

6. Go to **Settings** → **LLM provider** → **Configure**:
   - Pick your provider (e.g. OpenAI).
   - Enter model (e.g. `gpt-4o-mini`).
   - Paste your API key.
   - **Save**, then **Test**. Expect "Works" with a short reply.

**Checkpoint**: The settings now show "Configured" with your provider,
model, and a masked key. The **Chat** tab should NOT appear yet (no
non-setup conversations exist).

---

## Part 2 — Design conversations (Claude Code + MCP)

Open Claude Code in your station working directory. The agent needs
`mcp` in its surfaces — add it in Settings if missing.

Set the active memory to the Sage system memory:

> Set the active memory to Sage System.

### 2.1 — Create the `onboarding` conversation

Ask Claude Code:

> Create a conversation called `onboarding` in the Sage system memory
> with 3 stages: `welcome`, `background`, and `goals`. This is NOT a
> setup conversation (isSetup: false).
>
> Stage order: welcome → background → goals.
>
> Here are the details for each stage:
>
> **welcome** stage:
> - promptRef: `prompts:onboarding:welcome`
> - extractionSpec:
>   - `memory.name` (string): "The user's full name"
>   - `memory.location` (string): "City and state/country"
> - Prompt content: "Greet the user warmly. Ask for their name and
>   where they're based. Use the respond tool."
>
> **background** stage:
> - promptRef: `prompts:onboarding:background`
> - extractionSpec:
>   - `memory.business_type` (string): "What kind of business they run"
>   - `memory.business_age` (string): "How long they've been in business"
>   - `memory.team_size` (string): "Number of employees or solo"
> - Prompt content: "Now that you know the user's name, ask about their
>   business: what do they do, how long have they been at it, and what's
>   their team size? Summarize what you've learned before moving on.
>   Use the respond tool."
>
> **goals** stage:
> - promptRef: `prompts:onboarding:goals`
> - extractionSpec:
>   - `memory.top_goal` (string): "Their #1 business goal right now"
>   - `memory.biggest_challenge` (string): "The main obstacle to that goal"
> - Prompt content: "Ask the user what their #1 business goal is right
>   now, and what's the biggest challenge standing in the way. Reflect
>   back what you heard. When done, tell them you'll switch to strategy
>   mode. Set next_stage to null (end of this conversation).
>   Use the respond tool."

**Checkpoint**: Run `h-list-nodes` with prefix `conversations:onboarding`.
You should see:
```
conversations:onboarding
conversations:onboarding:welcome
conversations:onboarding:background
conversations:onboarding:goals
```

Read the `conversations:onboarding` node's data. Verify:
```json
{
  "isSetup": false,
  "stageOrder": ["welcome", "background", "goals"]
}
```

Read each stage node's data. Verify each has a `promptRef` and an
`extractionSpec` array with the fields listed above.

### 2.2 — Create the `strategy` conversation

> Create a conversation called `strategy` with 3 stages: `diagnose`,
> `options`, and `action-plan`. Not a setup conversation.
>
> Stage order: diagnose → options → action-plan.
>
> **diagnose** stage:
> - promptRef: `prompts:strategy:diagnose`
> - extractionSpec:
>   - `memory.current_problem` (string): "The specific problem being discussed"
>   - `memory.problem_severity` (string): "How urgent/severe: low, medium, high"
> - Prompt: "Ask the user to describe a specific business problem they
>   want to work on. Probe for details: when did it start, what have
>   they tried, how urgent is it? Use the respond tool."
>
> **options** stage:
> - promptRef: `prompts:strategy:options`
> - extractionSpec:
>   - `memory.options_discussed` (string): "Comma-separated list of options discussed"
>   - `memory.preferred_option` (string): "Which option the user leaned toward"
> - Prompt: "Based on the diagnosis, suggest 2-3 concrete options.
>   For each, give a one-sentence pro and con. Ask which resonates
>   most. Use the respond tool."
>
> **action-plan** stage:
> - promptRef: `prompts:strategy:action-plan`
> - extractionSpec:
>   - `memory.next_steps` (string): "Agreed next steps, semicolon-separated"
>   - `memory.timeline` (string): "When they'll start and any deadlines"
> - Prompt: "Formalize the user's preferred option into 2-4 concrete
>   next steps with a rough timeline. Confirm with the user. When
>   agreed, set next_stage to null. Use the respond tool."

**Checkpoint**: `h-list-nodes` with prefix `conversations:strategy`
should show 4 nodes (parent + 3 stages). Verify `stageOrder` and each
stage's `extractionSpec`.

### 2.3 — Verify all prompts exist

> List all nodes under `prompts:`.

You should see prompt nodes for every stage:
```
prompts:onboarding:welcome
prompts:onboarding:background
prompts:onboarding:goals
prompts:strategy:diagnose
prompts:strategy:options
prompts:strategy:action-plan
```

Each should have non-empty `content` with the prompt text.

---

## Part 3 — Run chats as test personas (Portal Chat tab)

Go back to the portal. Open the **Sage** agent detail page.

**Checkpoint**: The **Chat** tab should now be visible (the agent has
AI config + non-setup conversations).

### 3.1 — Persona 1: Alex Chen

Open the **Chat** tab. Click **New chat**.

The agent should greet you (this is the welcome turn from the first
non-setup conversation — `onboarding`).

Play the role of Alex Chen throughout this chat:

| Turn | You (as Alex) | What to watch for |
|------|---------------|-------------------|
| 1 | "Hi! I'm Alex Chen, based in Portland, Oregon." | Agent should extract name + location. |
| 2 | "I run a specialty coffee shop. Been at it about 2 years. Just me and two part-time baristas." | Agent should extract business_type, business_age, team_size. Watch for a **stage transition** from `welcome` → `background` (stage toast). |
| 3 | "My goal is to break even consistently — we're profitable some months but not others. The biggest challenge is foot traffic dropping in winter." | Agent should extract top_goal + biggest_challenge. Stage transition to `goals`. |
| 4 | (Agent should wrap up onboarding and suggest switching to strategy.) | Note: the conversation may end here. Start a **new chat** and select the `strategy` conversation if the agent doesn't switch automatically. |
| 5 | "My winter foot traffic drops 40%. I've tried seasonal drinks but it didn't move the needle much." | Agent should diagnose and extract current_problem + severity. |
| 6 | (Respond to the agent's options.) Pick whichever option sounds best. | Agent should extract options_discussed + preferred_option. |
| 7 | Confirm the action plan the agent proposes. | Agent should extract next_steps + timeline. |

**Stage transitions to watch for**: `welcome` → `background` → `goals`
in the onboarding chat. `diagnose` → `options` → `action-plan` in the
strategy chat. Each transition should show a **stage toast** in the UI.

### 3.2 — Persona 2: Maria Santos

Click **New chat** again. This time, play Maria Santos — a freelance
graphic designer who wants to grow beyond solo work.

| Turn | You (as Maria) | What to watch for |
|------|----------------|-------------------|
| 1 | "Hey, I'm Maria Santos, I'm in Austin, Texas." | Name + location extracted. |
| 2 | "I'm a freelance graphic designer. 4 years in, still solo — no employees." | Business info extracted. Stage transition. |
| 3 | "My goal is to double my revenue this year. Challenge is I can't take on more clients without help, but hiring feels risky." | Goal + challenge extracted. |
| 4 | Start a strategy chat. "I'm stuck doing everything myself — design, invoicing, client calls. I'm working 60-hour weeks and can't scale." | Problem + severity extracted. |
| 5–7 | Follow the agent's lead through options and action plan. | Full stage progression. |

**Important**: Maria should be a **different user** only if you can log
in as a second account. If not, note that both personas will share the
same per-user memory — which is expected for a single-user test. The
chats will still be separate.

### 3.3 — Partial data extraction test

Start one more chat as Alex (or a third persona). Deliberately withhold
information:

- Give your name but refuse to say where you're based ("I'd rather not
  say").
- Give your business type but dodge the team size question.

This tests that extraction works when the user provides partial data.
The extracted fields you shared should be populated; the ones you
withheld should be absent or null.

---

## Part 4 — Verify the results (Portal)

### 4.1 — Check the Chat tab

Open the Chat tab. You should see all your chats listed in the sidebar,
newest first. Each chat should show:

- A title (auto-derived from the first user message, or manually
  renamed).
- The conversation name (onboarding or strategy).

Click each chat to verify the full message history is intact.

### 4.2 — Check per-user memories

Go to your org's **Memories** page. Below the regular memories and
system memories, you should NOT see any shared "user data" memory.

The per-user memories are private and scoped to the agent. To find
them, go to the agent's Chat tab — the chats themselves live in the
per-user memory.

### 4.3 — Check extracted data

For each chat, the data extracted by the `extractionSpec` should be
stored in the chat's memory. Use Claude Code with MCP tools to inspect:

> List all nodes in my user memory for the Sage agent.

You should see:

- **Chat nodes** under `chats:*` — one per chat session.
- **Message nodes** under each chat — the full transcript.
- **Extracted data** in the `data` field of relevant nodes (the
  `memory.*` fields from `extractionSpec`).

Specific fields to verify for Alex Chen's onboarding chat:

```json
{
  "memory.name": "Alex Chen",
  "memory.location": "Portland, Oregon",
  "memory.business_type": "specialty coffee shop",
  "memory.business_age": "2 years",
  "memory.team_size": "3 (1 owner + 2 part-time baristas)",
  "memory.top_goal": "break even consistently",
  "memory.biggest_challenge": "winter foot traffic drop"
}
```

For the partial-data chat, verify that withheld fields are absent or
null, while shared fields are present.

### 4.4 — Check stage transitions

For each chat, verify the stage progression by reading the chat node's
data:

- **Onboarding chats**: should show progression through `welcome` →
  `background` → `goals`.
- **Strategy chats**: should show `diagnose` → `options` →
  `action-plan`.

If the agent didn't transition stages when expected, check:
1. Did the LLM include `next_stage` in the respond tool call?
2. Does the stage node's `extractionSpec` match what the LLM returned?
3. Is the `stageOrder` array in the conversation node correct?

---

## Expected end state summary

| Item | Count | Where to verify |
|------|-------|-----------------|
| Agents | 1 (Sage) | Agent detail page |
| System memory | 1 (Sage System) | System memories section |
| Knowledge memory | 1 (Sage Knowledge) | Org memories page |
| Conversations | 2 (onboarding, strategy) + 1 (setup, from wizard) | Chatbot Control tab |
| Stages | 3 per conversation (6 total for onboarding + strategy) | Chatbot Control tab |
| Prompts | 6 (one per stage) | `prompts:*` nodes in system memory |
| Chats | 4-5 (2 Alex, 2 Maria, 1 partial) | Chat tab sidebar |
| Per-user memories | 1 per user account | Created automatically |
| Extracted data | Varies per chat | `data` field on chat/memory nodes |
| Stage transitions | 2 per onboarding chat, 2 per strategy chat | Stage toasts during chat; chat node data |

## Test report checklist

When filing your test report, include:

- [ ] Agent created with correct system memory and knowledge memory
- [ ] Conversations and stages match the spec above
- [ ] All prompts exist with correct content
- [ ] Chat tab appeared after AI config + conversations were set up
- [ ] Alex Chen onboarding: all 5 fields extracted
- [ ] Alex Chen strategy: all 6 fields extracted
- [ ] Maria Santos onboarding: all 5 fields extracted
- [ ] Maria Santos strategy: all 6 fields extracted
- [ ] Partial data chat: present fields correct, absent fields null
- [ ] Stage transitions: toasts appeared at expected points
- [ ] Stage transitions: list each transition with turn number
- [ ] Chat transcripts: messages intact on reload
- [ ] Per-user memory: exists and contains chat nodes
- [ ] Any bugs, unexpected behavior, or unclear steps

## Troubleshooting

**Chat tab doesn't appear**: Check three things: (1) system memory is
set, (2) LLM provider is configured and tested, (3) at least one
non-setup conversation exists (the `setup` conversation from the wizard
has `isSetup: true` and doesn't count).

**Agent doesn't transition stages**: The LLM must include `next_stage`
in the respond tool call. If it doesn't, the stage stays where it is.
Check that the prompt explicitly instructs the LLM to "set next_stage
to `<name>` when done." If the prompt is vague ("move on when ready"),
the LLM may not emit the field.

**Extraction data is missing**: Check the stage's `extractionSpec` in
its data field. Each entry needs `field`, `description`, and `shape`.
Also check that the prompt tells the LLM what data to collect — the
LLM can only extract what it asks the user for.

**"No AI config saved yet" on test**: Save the config before testing.
The Test button can also test unsaved values — enter provider, model,
and key, then click Test without saving first.

**MCP tools don't see the agent**: The agent needs `mcp` in its
surfaces list. Chatbot agents default to `["api"]` only. Add `"mcp"`
in Settings.

## Automated testing with personas

After running through this manual test, consider automating it with
**test personas**. Define the Alex Chen and Maria Santos personas
once, then re-run them automatically whenever you change the chatbot.

See [test-personas.md](./test-personas.md) for the full guide. The
"live test" mode (`POST /api/agent-chat/test-persona`) runs all turns
using the agent's real LLM and produces a pass/fail report — same
fidelity as this manual test, but automatic.

## Related docs

- [test-personas.md](./test-personas.md) — automated testing with
  predefined personas (free dry-run + paid live test)
- [conversation-routing.md](./conversation-routing.md) — how topics,
  goals, edges, and the routing engine work
- [testing-a-chatbot-in-claude-code.md](./testing-a-chatbot-in-claude-code.md) —
  the Claude Code + MCP testing workflow (editing + testing in one loop)
- [portal-chat-testing.md](./portal-chat-testing.md) — portal Chat tab
  smoke test checklist
- [building-a-chatbot-agent.md](./building-a-chatbot-agent.md) — creating
  a chatbot from scratch
