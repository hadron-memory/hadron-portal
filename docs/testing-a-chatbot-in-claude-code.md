# Testing a Chatbot Agent in Claude Code

A step-by-step guide that builds an agent, designs conversations, runs
chats as test personas, and verifies results — all from Claude Code
using the Hadron MCP tools. No LLM API key needed; Claude Code's own
model plays the chatbot. Follow every step.

## What you will build

By the end of this test you will have:

- **1 agent** ("Sage") with a system memory and a knowledge memory.
- **2 conversations**: `onboarding` (learn about the user) and
  `strategy` (help with a business problem).
- **3 stages per conversation**, each with an `extractionSpec` that
  pulls structured data from the chat.
- **2 personas** (Alex Chen and Maria Santos), each with their own
  per-user memory.
- **Chat transcripts** in memory with extracted data, stage transitions,
  and message history — all verified via MCP tools.

## How Claude Code testing works

Hadron's Chat API is designed for production apps that call an LLM.
It returns a **compiled system prompt** and a **tool schema** for the
`respond` tool (structured JSON: `message`, `data`, `next_stage`). The
app calls the LLM, gets a response, and sends it back to Hadron.

In Claude Code testing, **Claude Code plays all the roles**:

1. It calls `h-start-chat` → gets the compiled prompt + tool schema.
2. It reads the prompt and generates a response **as the chatbot**.
3. It calls `h-process-chat-response` with the structured response.
4. You type the next user message; Claude Code calls
   `h-send-chat-message`, then repeats from step 2.

This is free (no external LLM calls) and fast (edit a prompt, test
immediately).

> **Important**: All user data and chat history belong in Hadron memory
> (stored automatically by the Chat API). Do NOT ask Claude Code to save
> data to files, JSON, or anywhere else. The Chat API handles storage.

## Two ways to test

| | Claude Code + MCP (this doc) | Portal Chat tab |
|---|---|---|
| **Cost** | Free (Claude Code's own model) | LLM API key costs per turn |
| **Speed** | Edit + test in same session | Must reload Chat tab |
| **Fidelity** | Claude Code model, not production model | Exact production model |
| **Best for** | Iterating on prompts, stages, extraction | Final validation |

## What you need

- A Hadron portal account at [hadronmemory.com](https://hadronmemory.com)
  with **admin** access to an organization.
- Claude Code installed and working.
- A Hadron station with the MCP proxy connected (see Part 1 below).

You do NOT need an LLM API key for this test path.

---

## Part 1 — Set up your station (Portal + local)

A **station** is how Claude Code authenticates to Hadron.

### 1.1 — Create a station

1. Go to **Stations** → **+ New station**.
2. **Name**: `your-name laptop` (e.g. `raghvind laptop`).
3. **Type**: Workstation.
4. **Role**: Contributor (you need write access).
5. **Organization**: the org where you'll create the agent.

### 1.2 — Subscribe to the agent

Skip this step for now — we haven't created the agent yet. Come back
here after Part 2.

On the station page → **Settings** tab → **Agents** → add the Sage
agent with **Read/Write** subscription.

### 1.3 — Download and install setup files

On the station page → **Client** tab:

1. Enter a label like `sage-test`.
2. Select **Claude Code**.
3. Click **Download setup files (.zip)**.
4. Extract the zip into a new working directory:
   ```
   mkdir ~/src/sage-testbed
   cd ~/src/sage-testbed
   unzip ~/Downloads/sage-test.zip
   ```

### 1.4 — Open Claude Code

```
cd ~/src/sage-testbed
claude
```

Type `/mcp`. You should see `hadron` listed as a connected MCP server
with tools starting with `h-`. If not, the station key isn't wired
up — ask for help.

**Checkpoint**: Run this in Claude Code:

> List my memories using h-list-memories.

You should see the memories accessible via your station. If the list is
empty, your station subscription isn't set up yet (come back after
Part 2, step 1.2).

---

## Part 2 — Create the agent (Portal)

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
   - System memory: auto-named `Sage System` — leave as-is.
   - Knowledge memory: keep checked. Auto-named `Sage Knowledge`.
5. Review and create.
6. On the agent detail page → **Settings** tab, check that **surfaces**
   includes `mcp`. If it only shows `api`, add `mcp`.

**Now go back to Step 1.2** and subscribe your station to the Sage
agent with Read/Write access. Then return to Claude Code.

**Checkpoint**: In Claude Code, run:

> List my memories.

You should now see `Sage System` and `Sage Knowledge`.

---

## Part 3 — Design conversations (Claude Code)

### 3.1 — Set the active memory

> Set the active memory to Sage System.

Claude Code will call `h-set-active-memory`. All subsequent node
operations target this memory.

### 3.2 — Verify the wizard scaffold

The wizard created a `setup` conversation with one `onboard` stage.
Let's verify:

> List all nodes with prefix `conversations`.

**Expected output** — 3 nodes:
```
conversations             (system)
conversations:setup       (system) — data: { isSetup: true, stageOrder: ["onboard"] }
conversations:setup:onboard  (system) — data: { promptRef: "prompts:setup:onboard", extractionSpec: [...] }
```

> Read the node at prompts:setup:onboard with raw: true.

You should see the onboard prompt text. This is the wizard's default —
we'll add real conversations next.

### 3.3 — Create the `onboarding` conversation

Copy-paste this entire block into Claude Code:

> Create the following nodes in the Sage System memory. Use h-add-node
> for each. Every node has nodeType "system".
>
> **Node 1: conversations:onboarding**
> - name: onboarding
> - description: Learn about the user and their business
> - data: { "isSetup": false, "stageOrder": ["welcome", "background", "goals"] }
>
> **Node 2: conversations:onboarding:welcome**
> - name: welcome
> - data:
>   ```json
>   {
>     "promptRef": "prompts:onboarding:welcome",
>     "extractionSpec": [
>       { "field": "memory.name", "description": "The user's full name", "shape": "string" },
>       { "field": "memory.location", "description": "City and state/country", "shape": "string" }
>     ]
>   }
>   ```
>
> **Node 3: conversations:onboarding:background**
> - name: background
> - data:
>   ```json
>   {
>     "promptRef": "prompts:onboarding:background",
>     "extractionSpec": [
>       { "field": "memory.business_type", "description": "What kind of business they run", "shape": "string" },
>       { "field": "memory.business_age", "description": "How long they've been in business", "shape": "string" },
>       { "field": "memory.team_size", "description": "Number of employees or solo", "shape": "string" }
>     ]
>   }
>   ```
>
> **Node 4: conversations:onboarding:goals**
> - name: goals
> - data:
>   ```json
>   {
>     "promptRef": "prompts:onboarding:goals",
>     "extractionSpec": [
>       { "field": "memory.top_goal", "description": "Their #1 business goal right now", "shape": "string" },
>       { "field": "memory.biggest_challenge", "description": "The main obstacle to that goal", "shape": "string" }
>     ]
>   }
>   ```
>
> **Node 5: prompts:onboarding** (parent)
> - name: onboarding
>
> **Node 6: prompts:onboarding:welcome**
> - name: welcome
> - content: "Greet the user warmly. Ask for their name and where they're based. Respond using the 'respond' tool. Include any info they share in the data field."
>
> **Node 7: prompts:onboarding:background**
> - name: background
> - content: "You already know the user's name. Now ask about their business: what do they do, how long have they been at it, team size? Summarize what you've learned before moving on. When done, set next_stage to 'goals'. Respond using the 'respond' tool."
>
> **Node 8: prompts:onboarding:goals**
> - name: goals
> - content: "Ask the user what their #1 business goal is right now, and the biggest challenge standing in the way. Reflect back what you heard. When done, tell them you'll switch to strategy mode. Set next_stage to null (end of conversation). Respond using the 'respond' tool."

**Checkpoint**: Verify the conversation was created correctly:

> List all nodes with prefix conversations:onboarding.

Expected — 4 nodes:
```
conversations:onboarding
conversations:onboarding:welcome
conversations:onboarding:background
conversations:onboarding:goals
```

> Read the data of conversations:onboarding.

Expected:
```json
{ "isSetup": false, "stageOrder": ["welcome", "background", "goals"] }
```

> Read the data of conversations:onboarding:welcome.

Expected — should contain `promptRef` and `extractionSpec` with
`memory.name` and `memory.location`.

### 3.4 — Create the `strategy` conversation

> Create these nodes in Sage System (all nodeType "system"):
>
> **conversations:strategy**
> - name: strategy
> - description: Help solve a specific business problem
> - data: { "isSetup": false, "stageOrder": ["diagnose", "options", "action-plan"] }
>
> **conversations:strategy:diagnose**
> - name: diagnose
> - data:
>   ```json
>   {
>     "promptRef": "prompts:strategy:diagnose",
>     "extractionSpec": [
>       { "field": "memory.current_problem", "description": "The specific problem being discussed", "shape": "string" },
>       { "field": "memory.problem_severity", "description": "How urgent: low, medium, high", "shape": "string" }
>     ]
>   }
>   ```
>
> **conversations:strategy:options**
> - name: options
> - data:
>   ```json
>   {
>     "promptRef": "prompts:strategy:options",
>     "extractionSpec": [
>       { "field": "memory.options_discussed", "description": "Comma-separated list of options", "shape": "string" },
>       { "field": "memory.preferred_option", "description": "Which option the user leaned toward", "shape": "string" }
>     ]
>   }
>   ```
>
> **conversations:strategy:action-plan**
> - name: action-plan
> - data:
>   ```json
>   {
>     "promptRef": "prompts:strategy:action-plan",
>     "extractionSpec": [
>       { "field": "memory.next_steps", "description": "Agreed next steps, semicolon-separated", "shape": "string" },
>       { "field": "memory.timeline", "description": "When they'll start and any deadlines", "shape": "string" }
>     ]
>   }
>   ```
>
> **prompts:strategy** (parent)
> - name: strategy
>
> **prompts:strategy:diagnose**
> - name: diagnose
> - content: "Ask the user to describe a specific business problem. Probe: when did it start, what have they tried, how urgent? Respond using the 'respond' tool."
>
> **prompts:strategy:options**
> - name: options
> - content: "Based on the diagnosis, suggest 2-3 concrete options. For each, give a one-sentence pro and con. Ask which resonates most. When the user picks one, set next_stage to 'action-plan'. Respond using the 'respond' tool."
>
> **prompts:strategy:action-plan**
> - name: action-plan
> - content: "Turn the user's preferred option into 2-4 concrete next steps with a rough timeline. Confirm with the user. When agreed, set next_stage to null. Respond using the 'respond' tool."

**Checkpoint**:

> List all nodes with prefix conversations:strategy.

Expected — 4 nodes. Verify `stageOrder` = `["diagnose", "options", "action-plan"]`.

### 3.5 — Verify all prompts

> List all nodes with prefix prompts.

Expected (at minimum):
```
prompts
prompts:setup
prompts:setup:onboard
prompts:onboarding
prompts:onboarding:welcome
prompts:onboarding:background
prompts:onboarding:goals
prompts:strategy
prompts:strategy:diagnose
prompts:strategy:options
prompts:strategy:action-plan
prompts:partials
prompts:partials:metadata-spec
```

---

## Part 4 — Run chats as test personas (Claude Code)

Now we test the conversations by playing two different personas. Claude
Code will play the chatbot (generate responses from the compiled
prompt), and you will type the user's messages.

### Key concepts before you start

- **`h-start-chat`** starts a chat and returns the compiled prompt +
  tool schema. Claude Code reads the prompt and generates the chatbot's
  **welcome message**.
- **`h-process-chat-response`** sends the chatbot's response back to
  Hadron. Pass `message` (the chatbot's reply text), `data` (extracted
  fields like `{ "memory.name": "Alex Chen" }`), and `next_stage`
  (null to stay, or the next stage name).
- **`h-send-chat-message`** sends the user's reply and returns an
  updated prompt + message history for the next chatbot response.
- The **chatbot's response** must always use the `respond` tool shape.
  Claude Code should generate `message`, `data`, and `next_stage` —
  not free-form text.
- **All data goes to memory automatically**. Do NOT use `h-add-node`
  or `h-update-node` to save user data. The Chat API handles it.

### 4.1 — Persona 1: Alex Chen (onboarding → strategy)

#### Start the onboarding chat

> Start a chat with the Sage agent for a user called "alex-chen",
> using the "onboarding" conversation. Use h-start-chat.
>
> Read the returned systemMessage and tools. Then generate a welcome
> message as Sage would — use h-process-chat-response with:
> - message: your welcome text
> - data: {} (no data to extract yet)
> - next_stage: null (stay in welcome stage)
>
> Show me the welcome message and pause.

**Expected**: Claude Code calls `h-start-chat`, reads the welcome
prompt, generates a warm greeting, and sends it via
`h-process-chat-response`. You see the chatbot's welcome.

**Write down the chat ID** returned by `h-start-chat` (e.g.
`chats:20260417-abc12345-onboarding`). You'll need it later.

#### Turn 1 — user introduces themselves

> The user (Alex) says: "Hi! I'm Alex Chen, based in Portland, Oregon."
>
> Call h-send-chat-message with this message. Read the returned prompt
> and message history. Generate Sage's response. Call
> h-process-chat-response with:
> - message: Sage's reply
> - data: { "memory.name": "Alex Chen", "memory.location": "Portland, Oregon" }
> - next_stage: "background" (transition to the next stage)
>
> Show me Sage's response and confirm the stage transition.

**Expected**: `h-process-chat-response` returns
`stageTransitioned: true`, `newStageName: "background"`.

#### Turn 2 — business background

> Alex says: "I run a specialty coffee shop. Been at it about 2 years.
> Just me and two part-time baristas."
>
> Same flow: h-send-chat-message → generate response →
> h-process-chat-response with:
> - data: { "memory.business_type": "specialty coffee shop", "memory.business_age": "2 years", "memory.team_size": "3 (1 owner + 2 part-time)" }
> - next_stage: "goals"

**Expected**: Stage transitions to `goals`.

#### Turn 3 — goals

> Alex says: "My goal is to break even consistently. Biggest challenge
> is foot traffic dropping 40% in winter."
>
> Process with:
> - data: { "memory.top_goal": "break even consistently", "memory.biggest_challenge": "winter foot traffic drop" }
> - next_stage: null (end of onboarding conversation)

**Expected**: The onboarding conversation ends. Chat stays in `goals`
stage with `next_stage: null`.

#### Start the strategy chat

> Start a NEW chat with Sage for user "alex-chen", conversation
> "strategy". Generate the welcome, process it. Then:
>
> Alex says: "My winter foot traffic drops 40%. I've tried seasonal
> drinks but it didn't help much."

Continue through `diagnose` → `options` → `action-plan`:

| Turn | Alex says | Extract | Transition to |
|------|-----------|---------|---------------|
| 1 | Winter foot traffic problem | `memory.current_problem`, `memory.problem_severity: "high"` | `options` |
| 2 | Responds to Sage's options | `memory.options_discussed`, `memory.preferred_option` | `action-plan` |
| 3 | Confirms the action plan | `memory.next_steps`, `memory.timeline` | null (end) |

### 4.2 — Persona 2: Maria Santos (onboarding only)

> Start a chat with Sage for user "maria-santos", conversation
> "onboarding". Same flow as Alex.

| Turn | Maria says | Extract |
|------|-----------|---------|
| Welcome | (Sage greets) | — |
| 1 | "Hey, I'm Maria Santos, Austin, Texas." | `memory.name`, `memory.location` |
| 2 | "Freelance graphic designer. 4 years, solo." | `memory.business_type`, `memory.business_age`, `memory.team_size` |
| 3 | "Double revenue. Can't scale without help but hiring feels risky." | `memory.top_goal`, `memory.biggest_challenge` |

### 4.3 — Partial data test

> Start a chat with Sage for user "partial-test", conversation
> "onboarding".

- Give your name: "I'm Pat." → extract `memory.name: "Pat"`.
- Refuse location: "I'd rather not say where I'm based." → extract
  `memory.location: null` or omit it from data.
- Give business type: "I sell handmade candles." → extract
  `memory.business_type`.
- Dodge team size: "It's complicated." → omit `memory.team_size`.

This tests that extraction works with incomplete data.

---

## Part 5 — Verify results (Claude Code)

### 5.1 — Verify chat transcripts

> List all nodes with prefix "chats" in the user memory for alex-chen.

You should see:
- 2 chat nodes (one onboarding, one strategy).
- Under each: a `messages` node with the full transcript.

> Read the messages node for Alex's onboarding chat.

Verify the message history contains all turns (user + assistant).

### 5.2 — Verify extracted data

> Read the data of Alex's onboarding chat node.

Look for the extracted fields:
```json
{
  "memory.name": "Alex Chen",
  "memory.location": "Portland, Oregon",
  "memory.business_type": "specialty coffee shop",
  "memory.business_age": "2 years",
  "memory.team_size": "3 (1 owner + 2 part-time)",
  "memory.top_goal": "break even consistently",
  "memory.biggest_challenge": "winter foot traffic drop"
}
```

Do the same for Alex's strategy chat:
```json
{
  "memory.current_problem": "winter foot traffic drop 40%",
  "memory.problem_severity": "high",
  "memory.options_discussed": "...",
  "memory.preferred_option": "...",
  "memory.next_steps": "...",
  "memory.timeline": "..."
}
```

And for Maria's onboarding chat — all 5 fields populated.

For the partial-data chat — `memory.name` = "Pat",
`memory.business_type` = "handmade candles", `memory.location` and
`memory.team_size` absent or null.

### 5.3 — Verify stage transitions

For each chat, count the stage transitions:

| Chat | Expected transitions |
|------|---------------------|
| Alex onboarding | welcome → background → goals (2 transitions) |
| Alex strategy | diagnose → options → action-plan (2 transitions) |
| Maria onboarding | welcome → background → goals (2 transitions) |
| Partial test | welcome → background (1, may stop early) |

---

## Expected end state

| Item | Count | How to verify |
|------|-------|---------------|
| Agent | 1 (Sage) | Portal agent detail page |
| System memory | 1 (Sage System) | `h-list-memories` |
| Knowledge memory | 1 (Sage Knowledge) | `h-list-memories` |
| Conversations | 3 (setup + onboarding + strategy) | `h-list-nodes` prefix `conversations` — depth 1 |
| Stages | 3 per real conversation (6 total) | `h-list-nodes` prefix `conversations:onboarding` etc. |
| Prompts | 6+ (one per stage) | `h-list-nodes` prefix `prompts` |
| Chats | 4+ (2 Alex, 1 Maria, 1 partial) | `h-list-nodes` prefix `chats` in user memories |
| Per-user memories | 3 (alex-chen, maria-santos, partial-test) | Created by h-start-chat |
| Extracted data | Varies per chat | `data` field on chat nodes |
| Stage transitions | 2 per full conversation | `h-process-chat-response` return values |

## Test report checklist

- [ ] Station created and connected to Claude Code
- [ ] Sage agent created with system + knowledge memory
- [ ] `mcp` in agent surfaces
- [ ] Station subscribed to Sage with Read/Write
- [ ] `onboarding` conversation: 3 stages, correct stageOrder
- [ ] `strategy` conversation: 3 stages, correct stageOrder
- [ ] All 6 stage prompts created with correct content
- [ ] All 6 stages have extractionSpec in data
- [ ] Alex onboarding: 5 fields extracted, 2 stage transitions
- [ ] Alex strategy: 6 fields extracted, 2 stage transitions
- [ ] Maria onboarding: 5 fields extracted, 2 stage transitions
- [ ] Partial test: present fields correct, absent fields null/missing
- [ ] Chat transcripts intact (messages node under each chat)
- [ ] Each persona has a separate per-user memory
- [ ] Any bugs, unexpected behavior, or unclear steps noted

## Troubleshooting

**"h-list-memories shows nothing"** — Your station isn't subscribed to
the agent, or the agent doesn't have `mcp` in surfaces.

**"h-start-chat says agent has no system memory"** — The agent's
`systemMemoryId` isn't set. Check agent Settings in the portal.

**"h-start-chat says no non-setup conversation found"** — You haven't
created the `onboarding` or `strategy` conversation yet, or they have
`isSetup: true` in their data. Only the wizard's `setup` conversation
should have `isSetup: true`.

**Stage didn't transition** — `h-process-chat-response` only
transitions if you pass a non-null `next_stage`. If you forgot it or
passed null, the stage stays. Re-do the turn with the correct
`next_stage` value.

**Extraction data is missing** — Check two things: (1) the stage's
`extractionSpec` in its data field must list the fields, (2) you must
pass those fields in the `data` parameter of
`h-process-chat-response`. The Chat API stores what you send — it
doesn't infer data from the message text.

**"The prompt didn't change after a stage transition"** — Call
`h-send-chat-message` after the transition. That's what re-compiles the
prompt for the new stage.

**Claude Code generates weird responses** — Remember, Claude Code is
playing the chatbot, not being a chatbot. If its responses don't match
the persona, just tell it what to say. The point is testing the Chat
API flow (extraction, transitions), not the quality of Claude's
roleplay.

## Data model reference

Understanding where things live:

| Concept | Where it's stored | How to inspect |
|---------|-------------------|----------------|
| Conversations, stages | System memory, nodes under `conversations:*` | `h-list-nodes` / `h-read-node` |
| Prompts | System memory, nodes under `prompts:*` | `h-read-node` with `raw: true` |
| Extraction specs | `data.extractionSpec` on stage nodes | `h-read-node` on the stage |
| Chat sessions | Per-user memory, nodes under `chats:*` | `h-list-nodes` in user memory |
| Message history | Per-user memory, under `chats:<id>:messages` | `h-read-node` |
| Extracted user data | `data` field on chat/memory nodes | `h-read-node` |
| Knowledge content | Knowledge memory, any structure | `h-list-nodes` / `h-read-node` |

The `content` field is markdown text (prompts, descriptions). The
`data` field is structured JSON (stage config, extracted facts). These
are different things — don't mix them up.

## Automated testing with personas

Once you've built and tested your chatbot manually, automate it with
**test personas**. Define a persona once, run it repeatedly — free in
Claude Code, or with the real LLM via the portal API.

See [test-personas.md](./test-personas.md) for the full guide.

Quick start:

```
> Define a test persona for [agent-id]:
>   Name: Alex Chen
>   Description: Coffee shop owner in Portland, 2 years in
>   Opening: "Hi, I'm Alex Chen from Portland"
>   Follow-ups: ["I run a coffee shop, 2 years, 3 people",
>                "Goal: break even. Challenge: winter foot traffic"]
>   Expected conversations: ["onboarding"]

> Run the Alex Chen persona test.
```

## Related docs

- [test-personas.md](./test-personas.md) — automated testing with
  predefined personas (free dry-run + paid live test)
- [conversation-routing.md](./conversation-routing.md) — how topics,
  goals, edges, and the routing engine work
- [chatbot-end-to-end-test.md](./chatbot-end-to-end-test.md) — same
  test using the portal Chat tab (costs money, production fidelity)
- [portal-chat-testing.md](./portal-chat-testing.md) — portal Chat tab
  smoke test checklist
- [building-a-chatbot-agent.md](./building-a-chatbot-agent.md) — creating
  a chatbot from scratch
