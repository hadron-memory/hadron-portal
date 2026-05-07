# hadron-portal

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

## Hadron sessions are orthogonal to Spec Kit

The Hadron session lifecycle (`h-start-session` → `h-save-session-task` →
`h-end-session`) runs alongside Spec Kit's chain — they're complementary,
not alternative. Spec Kit owns the workflow steps in between.

The 6-phase protocol returned by `h-start-session` lists "save plan" and
"update memory" as middle phases. **Under Spec Kit these are bookkeeping
markers, not separate tool calls.** `plan.md` is the saved plan — do
**not** call `h-save-plan`. Memory updates flow through `h-add-node` /
`h-update-node` directly (or via the `capture` hook), not through a
separate `h-update-memory` step. Always call `h-end-session` at close.

## Spec Kit

Drive feature work through `/speckit-specify` → `/speckit-clarify` →
`/speckit-plan` → `/speckit-tasks` → `/speckit-implement` →
`/speckit-finalize`.

The Hadron extension binds these commands to Spec Kit hook points:

| Hook point | Command | Optional |
|---|---|---|
| `before_specify` | `speckit.hadron.recall` — surface relevant prior knowledge | yes |
| `after_plan` | `speckit.hadron.capture` — capture research-phase findings | **no** |
| `after_implement` | `speckit.hadron.review` — apply review-criteria nodes to the diff | yes |
| `after_implement` | `speckit.hadron.capture` — capture implementation-phase findings | **no** |

`capture` binds twice on purpose — most learnings emerge during research/
recon and would be forgotten by end of implementation. Two captures with
fresher context each beats one end-of-session pass.

## Note: two kinds of "hooks"

**Spec Kit extension hooks** (the rows above) are the human-gated mechanism
declared in `.specify/extensions.yml`. Spec Kit's skills surface them to
the user — mandatory ones auto-execute, optional ones are offered as a
suggestion. These are what we use.

**Claude Code hooks** (`SessionStart`, `UserPromptSubmit`, `PostCompact`,
etc.) are an out-of-band injection mechanism that bypasses the human. We
do **not** use these in Spec Kit projects — they conflict with Spec Kit's
"everything goes through the human" pattern.

See [.specify/memory/constitution.md](.specify/memory/constitution.md) for
project governance.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
