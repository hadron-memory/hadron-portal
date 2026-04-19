# Test Personas

Automated chatbot testing with predefined personas. Define a persona
once, run it as many times as you want, get a pass/fail report.

## Two modes

| | Dry run (free) | Live test (costs money) |
|---|---|---|
| **Where** | Claude Code + MCP tools | Portal API |
| **Who plays the chatbot** | Claude Code's own model | Agent's configured LLM |
| **Cost** | Free | One LLM call per turn |
| **Best for** | Iterating on flow design | Final validation before publish |
| **Speed** | Interactive (you see each turn) | Automatic (all turns at once) |

Both modes use the same persona definition and produce the same report
format. Start with dry runs, then do a live test when the flow looks
good.

## Defining a persona

A test persona has:

- **Name**: who they are (e.g. "Maria Santos")
- **Description**: brief background and what they want
- **Opening message**: the first thing they say
- **Follow-up messages**: subsequent messages, in order
- **Conversation name** (optional): which conversation to start with
- **Expected conversations** (optional): the conversations the persona
  should visit, for pass/fail validation

### In Claude Code

```
> Use h-chat-define-persona for agent [agent-id].
> Name: Maria Santos
> Description: Freelance graphic designer in Austin, 4 years solo,
>   wants to double her revenue but can't scale without help.
> Opening message: "Hey, I'm Maria Santos from Austin."
> Follow-up messages:
>   - "I'm a freelance graphic designer. 4 years in, still solo."
>   - "My goal is to double my revenue. Challenge: can't scale
>     without help but hiring feels risky."
> Expected conversations: ["onboarding"]
```

Claude Code calls `h-chat-define-persona` and saves the persona in the
agent's system memory under `test-personas:maria-santos`.

### List existing personas

```
> List test personas for agent [agent-id].
```

Uses `h-chat-list-personas`.

## Running a dry-run test (free)

In Claude Code:

```
> Run the Maria Santos persona test for agent [agent-id].
```

Claude Code will:

1. Call `h-chat-run-persona` with step=0 → starts the chat, sends
   Maria's opening message, gets the compiled prompt back.
2. Generate a chatbot response based on the prompt (Claude Code's own
   model plays the chatbot).
3. Call `h-chat-process` with the response.
4. Call `h-chat-run-persona` with step=1 → sends the first follow-up.
5. Repeat until all follow-ups are done.
6. The final call returns a **test report**.

### The test report

```json
{
  "chatId": "chats:20260419-abc12345-onboarding",
  "status": "COMPLETE",
  "pass": true,
  "issues": [],
  "visitedConversations": ["onboarding"],
  "totalTurns": 8,
  "routeHistory": [ ... ],
  "goalStack": [ ... ]
}
```

**`pass`**: true if all `expectedConversations` were visited.

**`issues`**: list of problems found (missing conversations, off-track
turns, dead ends).

**`visitedConversations`**: which conversations the persona actually
went through.

**`routeHistory`**: full chronological log of stage enters/exits and
edge traversals.

**`goalStack`**: final state of the goal stack (completed, active, or
abandoned goals).

## Running a live test (costs money)

Call the portal API:

```
POST /api/agent-chat/test-persona
Content-Type: application/json
Authorization: Bearer <your-jwt>

{
  "agentId": "019d99f2...",
  "personaName": "Maria Santos",
  "openingMessage": "Hey, I'm Maria Santos from Austin.",
  "followUpMessages": [
    "I'm a freelance graphic designer. 4 years in, still solo.",
    "My goal is to double my revenue. Challenge: can't scale."
  ],
  "expectedConversations": ["onboarding"]
}
```

The server runs **all turns automatically** using the agent's
configured LLM (the same model real users will get). Returns the same
report format as the dry run, plus a full turn log:

```json
{
  "chatId": "...",
  "personaName": "Maria Santos",
  "pass": true,
  "issues": [],
  "turns": [
    { "step": 0, "role": "assistant", "message": "Welcome! I'm Sage..." },
    { "step": 1, "role": "user", "message": "Hey, I'm Maria Santos..." },
    { "step": 1, "role": "assistant", "message": "Nice to meet you, Maria!...",
      "stageTransitioned": true, "newStageName": "background" },
    ...
  ],
  "stageTransitions": [
    { "step": 1, "newStage": "background" },
    { "step": 2, "newStage": "goals" }
  ],
  "conversationsVisited": ["onboarding"],
  "totalTurns": 8
}
```

## Writing good personas

### Cover the happy path

Start with a persona that follows the expected flow perfectly — gives
their name, answers questions, provides all the data the extraction
spec expects. This validates that the basic flow works.

### Test partial data

Create a persona that withholds information: refuses to give their
location, dodges the team size question. This validates that the
chatbot handles missing data gracefully and that conditional edges
fire correctly.

### Test off-topic messages

Create a persona whose follow-up messages go off-topic: "Actually,
can I ask about billing instead?" This tests `onTrack` detection and
re-routing.

### Test conversation transitions

Create a persona with follow-ups that naturally span two conversations
(e.g., onboarding → strategy). Set `expectedConversations` to both.
This validates that edge-based routing works end-to-end.

### Name personas clearly

Use real-sounding names with a specific scenario. "Maria Santos —
freelance designer, partial data" is much more useful than
"test-user-3".

## Recommended test workflow

1. **Define 3–5 personas** covering happy path, partial data, off-topic,
   and cross-conversation flows.
2. **Dry-run each persona** in Claude Code. Fix any issues in the
   conversation design (prompts, stages, edges, goals).
3. **Iterate**: edit the conversation, re-run the persona, check the
   report. No cost, fast feedback.
4. **Live-test** each persona once the dry runs pass. This validates
   the real model.
5. **Save a revision** (`createRevision`) after all personas pass.
6. **Publish** the revision (`publishRevision`).
7. **Re-run personas after any change** to catch regressions.

## MCP tools reference

| Tool | Description |
|------|-------------|
| `h-chat-define-persona` | Create or update a test persona |
| `h-chat-list-personas` | List all personas for an agent |
| `h-chat-run-persona` | Run a dry-run test step (iterative) |
| `h-chat-get-route-history` | Read route history after a test |

## Related docs

- [conversation-routing.md](./conversation-routing.md) — how routing,
  edges, goals, and the goal stack work
- [testing-a-chatbot-in-claude-code.md](./testing-a-chatbot-in-claude-code.md) —
  manual testing in Claude Code
- [chatbot-end-to-end-test.md](./chatbot-end-to-end-test.md) — manual
  end-to-end test with the portal Chat tab
