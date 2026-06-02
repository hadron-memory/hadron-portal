# hadron-portal

At the start of **every change** — before drafting a plan — call `h-read-node`
with `urn: "urn:node:hadronmemory.com::dev::start-here"`. It's a
symptom-to-pattern routing index into the findings, conventions, ops, and
review branches. For one-time orientation (what Hadron is, repo layout, where
the source of truth lives), read `urn:node:hadronmemory.com::dev::instructions`.

## Before reading code, consult Hadron memory

Before reading project code to build context for a task, query Hadron memory
first: `h-find-nodes` for the topics, entities, and decision areas in the
request, then `h-read-node` for promising hits. Cite node `loc` values when
you reference what you found.

Hadron is the project's institutional memory — assume it covers things that
aren't obvious from code alone (past incidents, decisions whose rationale
isn't documented, conventions baked into multiple places).

## Capture findings as they emerge

When a non-obvious finding emerges — a convention you discovered, a gotcha
you hit, a node that turned out to be wrong — capture it immediately via
`h-add-node` or `h-update-node`. Don't batch to end-of-session; context
decays and findings get lost. The `speckit.hadron.capture` hook (bound at
`after_plan` and `after_implement`) is a backstop, not the primary
mechanism.
