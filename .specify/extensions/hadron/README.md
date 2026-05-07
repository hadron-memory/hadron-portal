# Hadron Memory Integration — Spec Kit Extension

Three commands that hook into Spec Kit's pipeline to use the Hadron Graph for
institutional memory. The integration is **mutual-read** — Hadron reads Spec
Kit's artifacts via the agent's tooling; Spec Kit calls Hadron through these
commands. Neither writes into the other's directory.

## Commands

| Command | Recommended hook | Optional | Purpose |
|---|---|---|---|
| `speckit.hadron.recall`  | `before_specify`   | yes | Surface relevant prior decisions, conventions, and gotchas *before the spec is written*, so it informs the spec itself. |
| `speckit.hadron.capture` | `after_plan`       | **no** | Propose and (with human approval) capture research-phase findings — codebase recon, decisions made, conventions discovered while reading the existing system. |
| `speckit.hadron.review`  | `after_implement`  | yes | Apply the project's review-criteria nodes to the implementation diff. |
| `speckit.hadron.capture` | `after_implement` (after review) | **no** | Propose and (with human approval) capture implementation-phase findings — gotchas, plan-vs-reality mismatches, surprises that emerged while shipping. |

`capture` binds twice — once at `after_plan` and once at `after_implement` — because most learnings emerge during research/recon and would be forgotten by end of implementation. Two captures with fresher context each beats one end-of-session pass.

Both `capture` bindings are non-optional: Spec Kit will surface the capture proposal to the human at each event so it doesn't get silently skipped. (`recall` and `review` are optional — they're useful but not load-bearing for the memory loop.)

Under `after_implement`, `review` runs before `capture` so capture reflects what actually shipped. Spec Kit executes hook array entries in order, so keep `review` listed before `capture` when you merge the bindings into your `.specify/extensions.yml`.

## Requirements

The agent running Spec Kit must have the Hadron MCP server configured and
connected, exposing at minimum:

- `h-find-nodes`
- `h-read-node`
- `h-add-node`   (capture only)
- `h-update-node` (capture only)

If Hadron MCP isn't connected, each command surfaces the gap to the human and
stops cleanly — Spec Kit's pipeline continues without Hadron-side actions.

## Installation

```bash
hadron-client install-extension
```

This copies the bundled extension into `<project>/.specify/extensions/hadron/`.
Then bind the commands to hook points in your **own** `.specify/extensions.yml`
— the recommended bindings are echoed by `install-extension` and listed above.
The bindings are yours to choose; nothing is wired automatically.

## Why this shape

- **No Spec Kit fork.** This extension uses Spec Kit's first-class extension
  system the same way the bundled `git` extension does.
- **No edits to your `.specify/` files.** The extension lives in its own
  subdirectory; binding to hook points is your edit, not ours.
- **No agent-specific hooks.** Works in any AI agent that supports MCP and
  Spec Kit. We do not inject prompts via Claude Code hooks.
- **Human in the loop.** Each command presents results to the human; capture
  in particular always proposes before writing.

## Disabling

Either delete `.specify/extensions/hadron/` or remove the Hadron entries from
your `.specify/extensions.yml` `hooks:` section. Spec Kit's pipeline runs
unchanged without the extension.
