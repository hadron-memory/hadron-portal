# Testing a Chatbot Agent in Claude Code

This guide walks you through building and testing a Hadron chatbot agent
(like Juno) from inside Claude Code using the Hadron MCP tools. If you're
new to Hadron and Claude Code, read this top to bottom.

## What this is for

You want to iterate quickly on a chatbot's conversation flow — editing
prompts, adding stages, tweaking extraction specs — and see the effect
immediately. The fastest way to do that is inside Claude Code, because
Claude can both *edit* the chatbot's memory and *play* the chatbot when
you want to test a flow.

## Two kinds of "Claude" — don't confuse them

When we talk about Claude in this doc, we mean two very different things,
and they do not do the same job. Mixing them up will make everything
confusing.

### 1. Claude Code — an AI *agent*

Claude Code is an application. It runs Claude-the-model inside a loop
that has access to tools: reading files, running commands, calling MCP
servers, and so on. It takes multiple turns, makes decisions, and
orchestrates tool calls on your behalf.

When you type a request into Claude Code, the agent decides which tools
to call and in what order. That includes Hadron MCP tools like
`h-read-node` or `h-start-chat`. Claude Code is a general-purpose
assistant with hands.

### 2. Claude-the-model — just the LLM

Underneath Claude Code (and every other AI app) is the model itself —
accessible via the Anthropic API, AWS Bedrock, or Google Vertex. It
takes a prompt, returns a response, and that's it. One request, one
response. No tools unless you wire them up, no memory between calls, no
loops.

When a chatbot like Juno runs in production, **it is running on the raw
model, not on an agent like Claude Code**. The production app (a mobile
app, web chat, SMS bot) calls the Anthropic API directly. It sends a
system prompt plus the conversation history, gets a structured response
back, and processes it.

### Why the distinction matters

Hadron's Chat API is designed for production apps using the **raw
model**. It returns:

- a **compiled system prompt** (with all Mustache variables resolved)
- a **tool schema** for the `respond` tool (so the model replies with
  structured JSON: `message`, `data`, `next_stage`)

The production app takes both of these, calls the LLM, and sends the
response back to Hadron. Hadron then extracts data into the user memory
and figures out the next stage.

When you test from Claude Code, you're doing the same dance, but Claude
Code *plays the role* of the production app. You ask it to call
`h-start-chat`, read the returned prompt, pretend to be the chatbot,
call `h-process-chat-response`, and so on. This is a test harness, not
how real users will ever interact with it.

> **Mental model:** the chatbot is the prompt + the data, not the model
> running it. Any LLM (Claude, GPT-4, a Bedrock model) can be the
> "engine." Hadron owns the *script*; the production app owns the
> *engine*.

## Prerequisites

- Access to the Hadron portal ([hadronmemory.com](https://hadronmemory.com))
- Access to the chatbot agent you want to test (e.g. Juno) — ask the
  team which org it lives in
- Claude Code installed and working on your laptop
- `hadron-client` installed (the MCP proxy) — if unsure, ask

## Step 1 — Create a station for yourself

A **station** is how Claude Code authenticates to Hadron. Think of it as
an API key attached to a named client.

1. Go to **Stations** → **+ New station**
2. Name it something like `your-name laptop`
3. Type: **Workstation**
4. Role: **Contributor** (you need write access to edit the chatbot)
5. Organization: the org that owns the chatbot

## Step 2 — Subscribe the station to the agent

On the station page → **Settings** tab → **Agents** → add the chatbot
agent with **Read/Write** subscription.

Read/Write matters — you're going to edit the chatbot's system memory,
so read-only won't cut it.

## Step 3 — Download setup files and install them

On the station page → **Client** tab:

1. Enter a label like `juno-test`
2. Select **Claude Code**
3. Click **Download setup files (.zip)**
4. Extract the zip into a new working directory (e.g.
   `~/src/juno-testbed`)

The zip contains `.mcp.json` and a `.hadron/` folder. Those tell
Claude Code where to find the Hadron MCP server and which key to use.

## Step 4 — Open the directory in Claude Code

```
cd ~/src/juno-testbed
claude
```

In Claude Code, type `/mcp`. You should see `hadron` listed as a
connected MCP server, with a long list of tools starting with `h-`. If
you don't, the station key isn't wired up — ask for help.

## Step 5 — Explore the chatbot's memory

Before you touch anything, look around. Ask Claude Code:

> List the nodes under `conversations/` in the juno-system memory.

Claude Code will call `h-list-nodes` and show you what's there — the
`setup` conversation, its `onboard` stage, any other stages you've
built.

Then:

> Read the onboard stage's data and the prompt it references.

Claude Code will use `h-read-node` to pull up the stage node (which
carries the `promptRef` and `extractionSpec` in its `data` field) and
then read the prompt node. Use `raw: true` on the prompt read if you
want to see the Mustache source instead of the compiled version.

## Step 6 — Edit the chatbot

Now you can iterate. Examples:

> Update the `prompts:setup:onboard` node so it also asks the user what
> city they live in.

Claude Code will call `h-update-node` with the new content. Verify by
reading the node back.

> Add a new stage called `goals` under the setup conversation. It
> should ask the user what their top business goal is and extract it as
> `memory.topGoal`. Wire it up so onboard transitions to goals.

Claude Code will:
1. Create the stage node with `h-add-node`, setting `data.promptRef`
   and `data.extractionSpec`
2. Create the corresponding prompt node under `prompts:setup:goals`
3. Update the setup conversation's `data.stageOrder` to include the new
   stage

After any edit, you can test the flow immediately (next step).

## Step 7 — Test the flow

Ask Claude Code to play the chatbot:

> Start a chat with the Juno agent for a fake user named `test-user-1`.
> Read the returned prompt, then respond the way Juno would — use the
> `respond` tool shape with `message`, `data`, and `next_stage`.
> Call `h-process-chat-response` with your response. Pause after that
> so I can reply as the user.

What's happening under the hood:

1. **`h-start-chat`** — you (the test harness) start a session for a
   user. Hadron compiles the onboard prompt with any Mustache variables
   already resolved and returns it along with the `respond` tool
   schema.
2. **Claude Code reads the prompt** and generates a response in the
   shape the tool schema requires. In production, this is where a
   separate LLM API call would happen — here, Claude Code's own model
   does it directly.
3. **`h-process-chat-response`** — you send the response back. Hadron
   extracts any `data` into the user memory, decides whether to
   transition stages, and hands you the next turn's prompt.
4. You then play the user by calling **`h-send-chat-message`** with
   their reply, which triggers steps 2–3 again.

Keep going until you've walked through the conversation. Each turn,
verify that the extraction worked by reading the user memory:

> Read the `memory.name` node in the juno-user-data memory.

If the name you provided isn't there, something's wrong with the
extraction spec or the prompt.

## Step 8 — Compare against production

After testing in Claude Code, remember: in production, a mobile app or
web chat will do exactly the same dance, but the LLM will be a raw
Anthropic/Bedrock API call. The app is responsible for:

- Calling `h-start-chat` once per session
- Calling the LLM with the compiled prompt + tool schema
- Parsing the tool-call response
- Calling `h-process-chat-response` with it
- Repeating with `h-send-chat-message` for each user reply

If your chatbot works in Claude Code but breaks in production, suspect:

- **Model differences** — Claude Code uses Claude; production might use
  a different model (e.g. Claude Haiku or a Bedrock model) that handles
  the prompt differently
- **Tool-call parsing** — the production app must correctly parse the
  LLM's tool call into the shape `processChatResponse` expects
- **Mustache variables** — if the prompt references data that doesn't
  exist in the user memory, the variable renders empty. Test with both
  a brand-new user and a returning user with populated data

## Common pitfalls

**"The LLM doesn't follow my prompt."** — You are writing the prompt
for the *raw model*, not for an agent. Don't assume it will figure out
what you mean the way Claude Code does. Be explicit. If you want JSON
structured like X, say so and show an example. Production models are
less forgiving than an agent loop.

**"My edits don't show up in the test chat."** — The compiled prompt
is built at `h-start-chat` time. Start a fresh chat after each edit to
pick up the new content.

**"The extraction didn't save."** — Check three things: (1) the stage's
`extractionSpec` in its `data` field, (2) the prompt actually instructs
the LLM to include the data it should extract, and (3) the tool-call
response actually included the expected fields. Use `h-read-node` on
the chat session node to see exactly what was sent/received.

**"I broke the chatbot."** — Everything is versioned in the memory
graph. `h-read-node` with `raw: true` shows the source. If you're
really lost, ask a senior engineer to help you recover from git or
revert via the portal.

## Related docs

- [building-a-chatbot-agent.md](./building-a-chatbot-agent.md) — creating a
  chatbot from scratch
- [building-an-agent.md](./building-an-agent.md) — general Hadron agent
  concepts
