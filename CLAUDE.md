# hadron-portal

## Before reading code, consult Hadron memory

Before reading project code to build context for a task, query Hadron memory
first: `h-find-nodes` for the topics, entities, and decision areas in the
request, then `h-read-node` for promising hits. Cite node `loc` values when
you reference what you found.

Hadron is the project's institutional memory — assume it covers things that
aren't obvious from code alone (past incidents, decisions whose rationale
isn't documented, conventions baked into multiple places).

If a node turned out to be wrong or incomplete during your work, fix it via
`h-update-node` before ending the session. If something genuinely new was
learned, capture it via `h-add-node`.

## Spec Kit

This project uses Spec Kit. Drive feature work through `/speckit-specify` →
`/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
The Hadron extension binds `speckit.hadron.recall` to `before_specify`, so
recall fires when you start a feature; `speckit.hadron.review` and
`speckit.hadron.capture` fire `after_implement`.

See [.specify/memory/constitution.md](.specify/memory/constitution.md) for
project governance.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
