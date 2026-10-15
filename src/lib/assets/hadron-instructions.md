# Hadron — AI Agent Instructions

This project is connected to **Hadron**, a knowledge memory platform for AI agents.
Hadron stores context across sessions in a knowledge graph — what's been learned,
decided, and built. Use it to stay consistent with past decisions, specs, and
conventions.

## How It Works

Hadron organizes knowledge as **nodes** in a tree-like graph within **memories**.
Each node has a location path (`loc`) using colon-delimited segments (e.g.
`specs:app-key-composition`). The full URN includes the memory
(e.g. `hadronmemory.com:dev:specs:app-key-composition`).

Your App is subscribed to one or more Agents, each of which provides access
to one or more Memories. This is the composition chain:

```
App → Agent → Memory → Nodes
```

## MCP Tools

You have access to these tools via the Hadron MCP server:

### Session Management

| Tool | Description |
|------|-------------|
| `hadron_start_session` | Start a new session: `description` (required) says what it is about; pass `workerRef` (a worker's name, URN or id) to work as that named teammate |
| `hadron_whoami` | Show your open session id and the worker it is bound to |
| `hadron_get_worker` | Re-read a worker's boot briefing |
| `hadron_create_resume_claim` | Before a deliberate context reset that keeps your session open, write a resume claim as the last step: single use, 60 seconds, and only you can redeem it |
| `hadron_resume_session` | After a context reset, call it first, with no arguments: your resume claim rebinds your worker and returns its briefing and handoff. Several are listed for you to pick from, never guessed; with nothing to resume it answers `NOTHING_TO_RESUME` and binds nothing |
| `hadron_end_session` | End session with summary and outcome; pass `resumeClaim: true` to leave a resume claim for the session that follows |

**Recovering after a context reset.** If your conversation loses its context
(a compaction, or a new chat window), don't start a new session: the open one
is still yours, and starting another leaves it behind. Call `hadron_whoami` to
get your open session id (and, if you work as a named worker, which one), and
`hadron_get_worker` to re-read that worker's briefing. Then carry on with the
same session id.

### Reading & Searching

| Tool                      | Description                                                                  |
|---------------------------|------------------------------------------------------------------------------|
| `hadron_get_node`         | Read a node by its rel path                                                  |
| `hadron_get_next_node`    | If a node is an item in an ordered list of nodes (`Node.seq`), read the next |
| `hadron_find_nodes`       | Search nodes by name, tags, or description                                   |
| `hadron_list_nodes`       | Browse the tree structure of a memory                                        |
| `hadron_set_active_memory`| Set which memory you're working in                                           |

When setting the active memory with `hadron_set_active_memory`, set the URN of that memory
also in the local config file at `.hadron/config.yml`.

### Writing & Editing

| Tool | Description |
|------|-------------|
| `hadron_create_node` | Add a new content node |
| `hadron_create_parent_node` | Create a section/category node for organizing children |
| `hadron_update_node` | Update an existing node (upsert) |
| `hadron_move_node` | Move a node and its children to a new location |

## Workflow

1. **Start a session** with `hadron_start_session` at the beginning of each task.
2. **Set active memory** with `hadron_set_active_memory` if you're working with a
   specific memory. This scopes subsequent tool calls.
3. **Read before writing.** Use `hadron_find_nodes` and `hadron_get_node` to check what
   context already exists before making changes. Pay special attention to `specs`
   nodes — these are authoritative references for how things should work.
4. **Update the graph** when you learn something new, make a decision, or notice
   outdated information. Use `hadron_create_node` or `hadron_update_node`.
5. **End the session** with `hadron_end_session` when the task is done. Include a
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

`Node.rel` is the path of a node and uses colon-delimited segments:
`specs:station-key-composition`.

When using tools, you can pass either:

- **rel** (e.g. `specs:auth-flow`) — used for reads
- **Full URNs** (e.g. `hadronmemory.com:dev:specs:auth-flow`) — used for writes
  and when the active memory isn't set

If you've set an active memory with `hadron_set_active_memory`, the tools handle
the conversion automatically.

## Review

If the active memory has a `Review` parent node, the children nodes are an ordered
list of nodes that contain instructions on how to review work that has been performed
with the use of this memory. When the user asks to review the work, look up
the review nodes and go through the instructions in the order of the nodes. 