# Building a Chatbot Agent

This guide walks through creating a Hadron agent that drives a conversational
AI chatbot — an AI mentor, support agent, research assistant, or any application
where the AI has structured conversations with end users.

## How It Works

Hadron doesn't make LLM calls. Your app does. Hadron provides:

- **Conversation designs** — stages with prompts and data extraction specs
- **Prompt compilation** — Mustache templates resolved with live data
- **Tool schemas** — for LLM structured output (data extraction in one call)
- **Memory** — user profiles, chat history, extracted facts, summaries
- **Orchestration** — stage transitions, conversation handoffs, summarization triggers

```
Your App → Hadron: "User said this"
Hadron → Your App: compiled prompt + tool schema + message history
Your App → LLM: makes the call
LLM → Your App: structured response (message + data)
Your App → Hadron: "LLM responded with this"
Hadron → Your App: display message + stage transition info
```

## Prerequisites

- A Hadron account with an organization
- An agent with at least two memories (see [Building an Agent](building-an-agent.md)):
  - A **read-only knowledge memory** with domain content
  - A **read-write user memory** for storing chat data and user profiles
- A third memory for the **system memory** (conversation designs)

## Step 1: Create the System Memory

The system memory holds your conversation designs — stages, prompts, and partials.
It's separate from domain knowledge so chatbot designers can iterate on prompts
without touching the knowledge base.

1. Create a new memory: e.g. "Juno Conversations" (`your-org.com:juno-conversations`)
2. Set visibility to **Organization** (your team can edit it)

## Step 2: Design Your Conversations

Conversations are `system` nodes under `conversations/` in the system memory.
Each conversation has stages, and each stage has a prompt.

### Create the conversation structure

Using MCP tools or the portal node editor:

```
conversations/
  setup/                          (nodeType: system)
    .data: { isSetup: true, stageOrder: ["onboard"] }
  
  find-mentor/                    (nodeType: system)
    .data: { stageOrder: ["understand", "search", "connect"] }
```

### Create the stages

Each stage is a child node of the conversation:

```
conversations/setup/onboard/      (nodeType: system)
  .data: {
    promptRef: "prompts:setup:onboard",
    extractionSpec: [
      {
        field: "memory.name",
        description: "The user's name",
        shape: "string"
      },
      {
        field: "memory.industry",
        description: "The user's business industry",
        shape: "string"
      }
    ]
  }
```

The `extractionSpec` tells Hadron what data to extract from the conversation.
Each field specifies:

- **field** — where to store the data (`memory.name` → the memory's default
  data node; `{chat}.topic` → the current chat's data)
- **description** — what the LLM should extract
- **shape** — the expected type (`string`, `number`, `string[]`, etc.)

### Create the prompts

Prompts live under `prompts/` for discoverability:

```
prompts/
  setup/
    onboard     (nodeType: system)
      content: |
        You are Juno, an AI mentor for entrepreneurs.
        Welcome the user warmly and learn about them.
        
        Ask about:
        - Their name
        - What industry they're in
        - What stage their business is at
        
        Current user data: {{memory.name}} in {{memory.industry}}
        
        {{> prompts:partials:metadata-spec}}
  
  find-mentor/
    understand  (nodeType: system)
      content: |
        The user is {{memory.name}}, in {{memory.industry}}.
        Help them articulate their biggest challenge.
        
        {{> prompts:partials:metadata-spec}}

  partials/
    metadata-spec  (nodeType: system)
      content: |
        Always respond using the 'respond' tool. Include:
        - message: your response to the user
        - data: any new information you learned
        - next_stage: null to stay, or the next stage name
```

Notice:
- **Mustache variables** (`{{memory.name}}`) are resolved from user data
- **Partials** (`{{> prompts:partials:metadata-spec}}`) include shared fragments
- Prompts are separated from stages — reusable and independently editable

## Step 3: Set Up the Agent

1. Create or update your agent
2. Set the **System Memory ID** to your conversation design memory
3. Add your knowledge memory (read-only) and user memory (read-write)

The agent now knows where to find conversation designs AND domain knowledge.

## Step 4: Integrate with Your App

### Start a chat

```graphql
mutation {
  startChat(
    agentId: "your-agent-id"
    userId: "end-user-123"
    conversationName: "setup"
  ) {
    chatId
    systemMessage
    tools
    conversationName
    stageName
  }
}
```

Returns:
- **chatId** — reference for subsequent calls
- **systemMessage** — compiled prompt (Mustache resolved, partials included)
- **tools** — tool schema built from the stage's extraction spec
- **stageName** — which stage we're in

### Send a user message

```graphql
mutation {
  sendChatMessage(
    chatId: "chats:202604121000-user-setup"
    userMessage: "Hi! I'm Maria, I run a small construction company."
  ) {
    systemMessage
    tools
    messageHistory
    summarizationNeeded { messageCount prompt }
  }
}
```

Returns the compiled prompt for the **current** stage (may have changed),
tool schema, and message history for the LLM call.

### Call the LLM

Your app calls the LLM with the system message, tools, and message history.
Using tool use, the LLM responds with structured JSON:

```json
{
  "message": "Welcome Maria! It's great to meet a fellow entrepreneur...",
  "data": {
    "name": "Maria",
    "industry": "construction"
  },
  "next_stage": null
}
```

### Process the response

```graphql
mutation {
  processChatResponse(
    chatId: "chats:202604121000-user-setup"
    toolResponse: {
      message: "Welcome Maria! It's great to meet...",
      data: { name: "Maria", industry: "construction" },
      next_stage: null
    }
  ) {
    displayMessage
    stageTransitioned
    newStageName
    conversationHandoff
    chatEnded
  }
}
```

Hadron:
- Saves the assistant message
- Stores `name` and `industry` in the user's data node
- Evaluates if the stage should transition (are all required fields populated?)
- Returns what to display to the user

### Handle stage transitions

When `stageTransitioned` is true, the next `sendChatMessage` call will return
a different compiled prompt (for the new stage). Your app doesn't need to do
anything special — just keep calling the same two endpoints.

### Handle conversation handoffs

When `conversationHandoff` is set, the current conversation is done and a new
one should start. Call `startChat` again with the new conversation name.
The user's data persists across conversations.

### Save summaries

When `summarizationNeeded` is returned, your app should:

1. Call the LLM with the summarization prompt and messages
2. Save the result:

```graphql
mutation {
  saveChatSummary(
    chatId: "chats:202604121000-user-setup"
    summary: "Maria runs a construction company. She needs help..."
  )
}
```

## Step 5: Stage Transitions and Edges

### Default linear flow

The `stageOrder` array defines the default sequence:

```json
{ "stageOrder": ["understand", "search", "connect"] }
```

### Conditional branching

Stages can have conditional edges that override the default:

```json
{
  "edges": [
    {
      "target": "conversations:onboard-manufacturing",
      "condition": "{{memory.industry}} == 'manufacturing'"
    },
    {
      "target": "conversations:onboard-generic"
    }
  ]
}
```

### LLM-controlled transitions

The LLM can force a transition by returning `next_stage` in its response.
This overrides both the default order and conditional edges.

**Priority**: LLM override > conditional edges > stageOrder default.

## Step 6: The Setup Conversation

The conversation with `isSetup: true` runs on first use. Use it for:

- Greeting the user
- Collecting essential information (name, preferences)
- Explaining what the chatbot can do
- Routing to the right specialized conversation

After setup, subsequent sessions can start with a router conversation
that presents choices based on what the user needs.

## Tips

### Keep prompts focused

Each stage should have one clear objective. Don't try to collect everything
in one stage — break it into focused steps.

### Use partials for shared instructions

Common instructions (metadata format, safety disclaimers, tone guidelines)
should be partials. Update them once, all stages get the update.

### Let the LLM manage tone

Don't over-script. Give the LLM the objective and let it manage the natural
language. Over-scripted prompts feel robotic.

### Test with real conversations

The best way to test is to have real conversations. Create a test station,
connect it, and chat. Iterate on prompts based on what works.

### Summarization matters

Configure summarization per conversation. Casual chats: every 20 messages,
concise style. Professional/legal chats: every 40 messages, detailed style.

## Architecture Reference

```
System Memory (read-only for the chatbot):
  conversations/     → conversation designs (system nodes)
  prompts/           → prompt templates and partials (system nodes)

Knowledge Memory (read-only):
  guides/            → domain knowledge the chatbot references
  resources/         → helpful links, tools, etc.
  references/        → external sources (papers, legislation)

User Memory (read-write, one per user or shared):
  data               → user profile and extracted facts
  chats/             → conversation history (record nodes)
    <chat-name>/
      messages/      → individual messages (record nodes)
      summary        → conversation summary (abstract node)
```
