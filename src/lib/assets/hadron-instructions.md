# Hadron — AI Agent Instructions

This project is connected to **Hadron**, a knowledge memory platform for AI agents.
Hadron stores context across sessions in a knowledge graph — what's been learned,
decided, and built. Use it to stay consistent with past decisions, specs, and
conventions.

## How It Works

Hadron organizes knowledge as **nodes** in a tree-like graph within **memories**.
Each node has a location path (`loc`) using colon-delimited segments (e.g.
`specs:station-key-composition`). The full URN includes the memory
(e.g. `hadronmemory.com:dev:specs:station-key-composition`).

Your Station is subscribed to one or more Agents, each of which provides access
to one or more Memories. This is the composition chain:

```
Station → Agent → Memory → Nodes
```

## MCP Tools

You have access to these tools via the Hadron MCP server:

### Session Management

| Tool | Description |
|------|-------------|
| `h-start-session` | Start a new session (level: basic/guided/learn) |
| `h-resume-session` | Resume an open session from a previous conversation |
| `h-save-session-task` | Save the current task definition |
| `h-end-session` | End session with summary and outcome |

### Reading & Searching

| Tool | Description |
|------|-------------|
| `h-read-node` | Read a node by its rel path |
| `h-find-nodes` | Search nodes by name, tags, or description |
| `h-list-nodes` | Browse the tree structure of a memory |
| `h-set-active-memory` | Set which memory you're working in |

### Writing & Editing

| Tool | Description |
|------|-------------|
| `h-add-node` | Add a new content node |
| `h-add-parent-node` | Create a section/category node for organizing children |
| `h-update-node` | Update an existing node (upsert) |
| `h-move-node` | Move a node and its children to a new location |

### Planning & PRs

| Tool | Description |
|------|-------------|
| `h-save-plan` | Save an implementation plan for the current task |
| `h-create-pr` | Create a GitHub PR with context |

## Workflow

1. **Start a session** with `h-start-session` at the beginning of each task.
2. **Set active memory** with `h-set-active-memory` if you're working with a
   specific memory. This scopes subsequent tool calls.
3. **Read before writing.** Use `h-find-nodes` and `h-read-node` to check what
   context already exists before making changes. Pay special attention to `specs`
   nodes — these are authoritative references for how things should work.
4. **Update the graph** when you learn something new, make a decision, or notice
   outdated information. Use `h-add-node` or `h-update-node`.
5. **End the session** with `h-end-session` when the task is done. Include a
   summary and outcome.

## Specs

If the memory has a `specs` section, always check it before making changes to
related code. Spec nodes are authoritative — they define how things should work
and prevent drift between sessions. Common spec topics include:

- Entity model and composition chain
- URN format and naming conventions
- Authentication and key composition
- MCP tool list and behavior
- Deployment process

## Node Paths

Node paths use colon-delimited segments: `specs:station-key-composition`.
When using tools, you can pass either:

- **Relative paths** (e.g. `specs:auth-flow`) — used for reads
- **Full URNs** (e.g. `hadronmemory.com:dev:specs:auth-flow`) — used for writes
  and when the active memory isn't set

If you've set an active memory with `h-set-active-memory`, the tools handle
the conversion automatically.
