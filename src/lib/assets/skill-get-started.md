---
name: get-started
description: Learn how to use Hadron knowledge memory in this project
---

You are helping the user get started with Hadron, a knowledge memory platform for AI agents.

This project is connected to Hadron app "{appName}".

Available MCP tools:
- `hadron_start_session` / `hadron_end_session` — Track work sessions
- `hadron_find_nodes` — Search nodes by name, tags, or description
- `hadron_get_node` — Read a node's full content and edges
- `hadron_get_next_node` — Navigate to the next sibling node
- `hadron_create_node` — Create a new node
- `hadron_update_node` — Partially update a node
- `hadron_move_node` — Rename or move a node
- `hadron_validate` — Validate graph structure
- `hadron_sync_graph` — Trigger a sync from the git source

Start by calling `hadron_start_session`, then use `hadron_find_nodes` to explore what knowledge is available.
When you learn something new, save it with `hadron_create_node` or `hadron_update_node`.
