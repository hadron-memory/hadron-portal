# Conversation Routing

How topics, conversations, stages, edges, and goals work together
to create chatbots that flow naturally between modes.

## The hierarchy

```
Agent
  └─ Topic (optional)        ← groups related conversations
       └─ Conversation        ← a coherent flow with a goal
            └─ Stage          ← a focused step with a prompt + extraction
```

**Topics** group conversations that share a broad goal. A yoga studio
bot might have topics "Class schedule", "Membership", and "General
help." Topics are optional — simple agents skip them.

**Conversations** are the core unit. Each has a goal ("help the user
find a mentor"), a sequence of stages, and routing metadata that helps
the system match user messages to the right conversation.

**Stages** are steps within a conversation. Each stage has a prompt
(what the chatbot says/asks), an extraction spec (what data to pull
from the user's response), and edges (where to go next).

## Goals and signals

Every conversation (and optionally every topic) carries routing
metadata:

```json
{
  "goalDescriptions": [
    "Help the user find class times and teacher availability",
    "Answer questions about the weekly schedule"
  ],
  "goalSignals": [
    "When is yoga?",
    "Is the Saturday class running?",
    "Who teaches on Monday?",
    "Is Nina back in town?"
  ]
}
```

**`goalDescriptions`** — natural-language descriptions of when this
conversation is the right fit. Multiple phrasings help the routing
engine match ambiguous user messages. Write them from the user's
perspective: "The user wants to..."

**`goalSignals`** — example user statements that should route here.
This is a **living list** — it grows over time as you discover new
ways users express the same need. Multi-language signals are
supported.

### Where to define them

Goals and signals live in the conversation node's `data` field. You
can set them via:

- The **Chatbot Control tab** in the portal (read-only display for now)
- The **Conversation Editor** (portal)
- **Claude Code** with `h-update-node` on the conversation node
- The **MCP tools** directly

## Edges

Edges connect stages to other stages or conversations. They encode
routing logic in the graph itself.

### Edge properties

```json
{
  "target": "conversations:profile-building",
  "condition": {
    "field": "memory.business_type",
    "operator": "missing"
  },
  "timing": "on_complete",
  "behavior": "detour",
  "label": "Fill profile if business type is missing"
}
```

| Property | Values | Description |
|----------|--------|-------------|
| `condition` | `{ field, operator, value? }` | When the edge fires. Optional — no condition = always fires. |
| `timing` | `on_complete`, `on_enter`, `always` | When to evaluate the condition. |
| `behavior` | `transition`, `detour` | `transition` = permanent move. `detour` = push to goal stack, come back when done. |
| `label` | any string | Human-readable description (shown in the editor). |

### Condition operators

| Operator | Description |
|----------|-------------|
| `missing` | Field is null, undefined, or empty string |
| `exists` | Field has a non-empty value |
| `equals` | Field equals the specified value |
| `notEquals` | Field does not equal the specified value |
| `contains` | Field (string) contains the specified value |

### Edge presets (UI shortcuts)

When creating edges in the editor, these presets fill in the
properties:

- **Next**: `timing: on_complete`, `behavior: transition`, no condition.
  "When this is done, go there."
- **Prerequisite**: `timing: on_enter`, `behavior: detour`, with a
  `missing` condition. "Before entering this stage, make sure we have
  this data."
- **Escape**: `timing: always`, `behavior: transition`, no condition.
  "The user can bail to this conversation at any time."
- **Fallback**: `timing: always`, `behavior: transition`, triggered by
  `onTrack: false`. "If the conversation is off track, go here."

## The `onTrack` field

Every chatbot response includes an `onTrack` boolean:

```json
{
  "message": "I see you want something else...",
  "data": { ... },
  "next_stage": null,
  "onTrack": false,
  "offTrackReason": "User is asking about billing, not the schedule"
}
```

When `onTrack` is false, the system knows the current conversation
isn't serving the user well. This triggers re-routing: the system
evaluates edges and goal signals to find a better conversation.

This is **continuous** — the LLM evaluates `onTrack` on every turn,
so drift is caught immediately.

## Goal stack

The user's state is a **stack**, not a single position:

```
[bottom]  Find government programs        (original goal)
          → Update business profile       (detour: missing data)
            → Confirm industry category   (sub-goal)  [top]
```

When the top goal completes, the system pops it and returns to the
previous goal. When the stack is empty, the user's original goal is
done.

The goal stack enables **detours**: "We need your business type before
we can find government programs. Let's update your profile first." The
system remembers where the user was and brings them back.

### How goals get pushed

- **Automatically**: when a `detour` edge fires, the system pushes the
  detour's goal and records the return point.
- **By the LLM**: when it detects an implicit goal ("you mentioned
  cash flow — want to work on that next?"), it can push via
  `h-chat-push-goal`.
- **By the user**: explicitly stating a new goal.

## Route history

Every chat records where it has been:

```json
[
  { "action": "ENTER", "conversationUrn": "conversations:onboarding", "nodeUrn": "conversations:onboarding:welcome", "timestamp": "..." },
  { "action": "ENTER", "conversationUrn": "conversations:onboarding", "nodeUrn": "conversations:onboarding:background", "trigger": { "type": "STAGE_TRANSITION" }, "timestamp": "..." },
  { "action": "ENTER", "conversationUrn": "conversations:strategy", "nodeUrn": "conversations:strategy:diagnose", "edgeUrn": "...", "trigger": { "type": "TRANSITION_EDGE" }, "timestamp": "..." }
]
```

Used for:
- **Debugging**: why did the chatbot end up here?
- **Loop prevention**: the server rejects routing suggestions that
  would send the user back to a conversation they just left.
- **Analytics**: which paths do users take? Where do they drop off?
- **Resumption**: when the user comes back, the system knows where
  they left off.

## Hierarchical extraction

Data extraction specs can live at three levels:

| Level | What it extracts | Scope |
|-------|-----------------|-------|
| Agent | User name, language, account ID | Every conversation |
| Conversation | Order number, problem description | All stages in that conversation |
| Stage | A yes/no confirmation, a rating | Just that step |

Each level inherits from above. A stage sees its own spec + the
conversation's spec + the agent's spec. Stage-level fields win on
conflict.

Agent-level specs live in a `config` node in the system memory:

```json
{
  "agentExtractionSpec": [
    { "field": "memory.name", "description": "User's full name", "shape": "string" },
    { "field": "memory.language", "description": "Preferred language", "shape": "string" }
  ]
}
```

## Fallback conversation

Every agent should have a fallback conversation — created
automatically by the wizard. It handles the case where no conversation
matches the user's request:

```
conversations:fallback
  stage: no-match
  prompt: "I can't help with that. Here's what I can do: [list].
           Or reach a person at [contact]."
```

The fallback conversation has `isFallback: true` in its data.

## MCP tools for routing

| Tool | Description |
|------|-------------|
| `h-chat-start` | Start a chat (returns compiled prompt + tool schema) |
| `h-chat-send` | Send a user message (returns updated prompt + history) |
| `h-chat-process` | Process the chatbot's response (extraction + routing) |
| `h-chat-get-routing-map` | Download the full conversation graph |
| `h-chat-get-route-history` | Read route history + goal stack for a chat |
| `h-chat-push-goal` | Push a new goal onto the stack |
| `h-chat-pop-goal` | Complete current goal, return to previous |
| `h-chat-add-training-entry` | Add a user statement to the routing training set |

## Related docs

- [test-personas.md](./test-personas.md) — automated testing with
  personas
- [chatbot-end-to-end-test.md](./chatbot-end-to-end-test.md) — manual
  end-to-end test guide
- [building-a-chatbot-agent.md](./building-a-chatbot-agent.md) —
  creating a chatbot from scratch
