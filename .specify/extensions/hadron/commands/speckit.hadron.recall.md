---
description: "Surface relevant prior knowledge from Hadron memory before specifying."
---

# Recall Prior Knowledge from Hadron Memory

Pull decisions, conventions, and gotchas relevant to the user's request from
the Hadron Graph **before** the spec is written. The goal is to inform the
spec itself with what the project has already learned — not to re-derive it
later during planning.

## When this runs

Invoked as a `before_specify` hook (configurable in `.specify/extensions.yml`).
At this point `spec.md` does not yet exist for the feature; the topic comes
from the user's `/speckit-specify` arguments.

## What to do

1. **Identify the topics.** Read the user's `/speckit-specify` arguments —
   the one-line topic and any description they provided. Extract the key
   entities, decision areas, and components the request touches. If the
   request is too vague to extract topics from, ask the user one clarifying
   question before proceeding.

2. **Query Hadron memory for relevant nodes.** Call `hadron_find_nodes` with each
   topic / entity / decision area as the `query`. Cast a wide net but keep
   each query specific (e.g. "auth middleware", not "auth"). Aim for the
   top-N most relevant results per query.

3. **Read the candidates.** For each promising hit, call `hadron_get_node` to
   get the full node content. Note its `loc` so it can be cited later.

4. **Summarize for the human.** Produce a short bulleted brief:

   ```markdown
   ## Hadron Recall — <topic>

   **Decisions / conventions that constrain this work:**
   - <node-loc> — <one-line takeaway>

   **Gotchas / prior incidents to watch for:**
   - <node-loc> — <one-line takeaway>

   **Knowledge gaps (no relevant nodes found for):**
   - <topic where Hadron memory was thin>
   ```

5. **Hand off to `/speckit-specify`.** Tell the human the recall is done and
   that the spec should reference relevant `<node-loc>` values where they
   apply. Do **not** write `spec.md` yourself — that's `/speckit-specify`'s
   job.

## Rules

- Read-only. Do not call `hadron_create_node` or `hadron_update_node` from this command.
- Do not write into `.specify/`. The recall output goes to the human via the
  chat, not to disk.
- If Hadron MCP is not connected, abort with a clear message and let the
  human decide whether to continue without recall.
- Keep the brief short — one line per node. Pointers, not summaries.

## Why

Spec Kit's specify phase otherwise re-derives context from scratch. Recall
front-loads the project's institutional memory so the spec is grounded in
what already exists. The brief is the human's tool, not the agent's — they
decide which nodes the spec should anchor on.
