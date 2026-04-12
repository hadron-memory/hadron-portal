# Building an Agent

This guide walks through creating a Hadron agent from scratch — setting up
memories, connecting a station, and configuring the agent for use with AI tools.

## Overview

An Agent in Hadron is a named configuration that bundles one or more Memories
and makes them accessible to Stations (connected AI tools). The composition
chain is:

```
Station → Agent → Memory → Nodes
```

## Prerequisites

- A Hadron account ([hadronmemory.com](https://hadronmemory.com))
- An organization (created automatically on signup)
- Node.js 20+ (for hadron-client, if using MCP)

## Step 1: Create a Memory

A memory is a knowledge graph — the container for your nodes.

1. Go to **Organizations** → your org → **Memories** → **+ Add memory**
2. Fill in:
   - **Name**: e.g. "Engineering Knowledge"
   - **URN slug**: e.g. "engineering" (becomes `your-org.com:engineering`)
   - **Visibility**: Private, Organization, or Public
3. Click **Create**

### Adding knowledge

You can add nodes to your memory in three ways:

- **Portal**: Browse to your memory → Memory tab → Graph or Nodes view. Use
  the node detail page to create and edit nodes.
- **MCP tools**: Connect an AI agent and use `h-add-node`, `h-add-parent-node`,
  `h-update-node` to build knowledge interactively.
- **Git sync**: Point the memory at a GitHub repo. Nodes are YAML + Markdown
  files synced automatically.

### Structured data on nodes

Any node can carry structured JSON data in its `data` field:

```json
{
  "family_size": 4,
  "dietary_restrictions": ["gluten-free"],
  "location": "Portland, OR"
}
```

Set data via the portal (Settings tab → Data section) or via `h-set-data`.

### Template variables

Node content can include Mustache templates:

```
Welcome, {{name}}! You live in {{location}}.
```

Variables resolve from the node's `data`, a default `data` node at the memory
root, or other nodes' data (e.g. `{{settings.theme}}`).

## Step 2: Create an Agent

1. Go to **Organizations** → your org → **Agents** → **+ Add agent**
2. Fill in:
   - **Name**: e.g. "Engineering Agent"
   - **Description**: What this agent is for
   - **System Prompt**: Instructions for the LLM (e.g. "You are a helpful
     engineering assistant. Always check the knowledge graph before answering.")
   - **Visibility**: Private or Organization
3. Click **Create Agent**

### Add memories to the agent

On the agent detail page → **Settings** tab → **Memories** section:

1. Select a memory from the dropdown
2. Choose access: **Read** or **Read/Write**
3. Click **Add**

An agent can have multiple memories — read-only knowledge bases plus a writable
memory for saving session data and learnings.

### System memory (for chatbot agents)

If your agent uses conversation designs (stages, prompts), set the
**System Memory ID** to the memory containing your conversation nodes.

## Step 3: Create a Station

A station is a connected client — your AI tool's identity.

1. Go to **Stations** → **+ New station**
2. Fill in:
   - **Name**: e.g. "My Laptop"
   - **Type**: Workstation (for coding), Chatbot (for chat apps), etc.
   - **Role**: Reader, Contributor, or Admin
   - **Organization**: your org
3. Click **Create station**

### Subscribe to the agent

On the station detail page → **Settings** tab → **Agents** section:

1. Select your agent
2. Choose subscription: **Read Only** or **Read/Write**
3. The agent is now subscribed — the station has access to all the agent's memories

### Download client configuration

On the station detail page → **Client** tab:

1. Enter a name for your client key
2. Select which AI tools you use (Claude Code, Cursor, etc.)
3. Click **Download setup files (.zip)**
4. Extract into your project root

The zip contains:
- `.mcp.json` — MCP server configuration
- `.hadron/` — config, instructions, and optional plugin

## Step 4: Connect your AI tool

### Claude Code (stdio mode)

The `.mcp.json` file tells Claude Code to launch hadron-client as a subprocess:

```json
{
  "mcpServers": {
    "hadron": {
      "command": "hadron-client",
      "args": ["stdio"],
      "env": { "HADRON_CLIENT_KEY": "your-key-here" }
    }
  }
}
```

Verify: in Claude Code, type `/mcp` — you should see "hadron" listed.

### Direct HTTP connection

For tools that support HTTP MCP servers:

```json
{
  "mcpServers": {
    "hadron": {
      "type": "http",
      "url": "https://srv.hadronmemory.com/mcp",
      "headers": {
        "Authorization": "Bearer your-key-here"
      }
    }
  }
}
```

### Custom applications (GraphQL API)

For Flutter apps, web apps, or custom integrations, use the GraphQL API directly:

```
POST https://srv.hadronmemory.com/graphql
Authorization: Bearer your-key-here
Content-Type: application/json
```

## Step 5: Use it

Your AI agent now has access to the knowledge in your memories. It can:

- **Read knowledge**: `h-read-node`, `h-find-nodes`, `h-list-nodes`
- **Write knowledge**: `h-add-node`, `h-update-node`
- **Store data**: `h-set-data`, `h-get-data`
- **Run guided sessions**: `h-start-session` at guided level
- **Start chats**: `h-start-chat` for conversational agents

### Guided sessions (for coding agents)

At guided level, the agent follows a 6-phase protocol:

1. Task definition → `h-save-session-task`
2. Information gathering → `h-read-node`
3. Implementation plan → `h-save-plan`
4. Performing work
5. Memory update → update/create knowledge nodes
6. Summary & quality check → `h-end-session`

See [hadron-client docs/guided-sessions.md](https://github.com/hadron-memory/hadron-client/blob/main/docs/guided-sessions.md) for details.

### Chat API (for conversational agents)

For chatbot applications, use the Chat API:

1. `startChat(agentId, userId)` → get compiled prompt + tool schema
2. Send to LLM → get structured response
3. `processChatResponse(chatId, response)` → extract data, transition stage
4. Repeat

See the [Chat API spec](https://github.com/hadron-memory/hadron-concept/blob/main/hadron-specs/Features/Chat-API.md) for details.

## Node Types

Use the right nodeType for your content:

| Type | Use for |
|------|---------|
| `info` | Knowledge, specs, guides (default) |
| `abstract` | Summaries, TL;DRs — searched first |
| `reference` | External sources (papers, URLs, legislation) |
| `record` | Chat messages, session logs — hidden by default |
| `system` | Conversation designs, prompts — hidden from search |
