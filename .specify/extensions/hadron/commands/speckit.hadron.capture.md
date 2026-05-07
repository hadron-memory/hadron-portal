---
description: "Capture knowledge and corrections back into Hadron memory."
---

# Capture What Was Learned into Hadron Memory

Update the Hadron Graph with non-obvious knowledge surfaced during this spec —
new conventions, corrections to outdated nodes, gotchas discovered during
research or implementation. This is the institutional-memory step.

## When this runs

Invoked at two hook points (configurable in `.specify/extensions.yml`):

- **`after_plan`** — captures research-phase findings as they crystallize:
  codebase recon results, decisions logged in `research.md`, conventions
  discovered while reading the existing system.
- **`after_implement`** — captures implementation-phase findings: gotchas,
  plan-vs-reality mismatches, test-infrastructure quirks, bugs in tooling.
  Runs *after* `speckit.hadron.review` (when bound) so capture reflects what
  actually shipped, not what was attempted.

Capturing twice — with fresher context each time — beats one end-of-session
pass that has to remember everything from earlier in the session.

## What to do

1. **Reflect on what's available, scoped to the current phase.**

   - At `after_plan`: read `spec.md`, `plan.md`, `research.md`, and the
     conversation context from this session. Focus on findings new since the
     last capture (or since session start if this is the first capture).
   - At `after_implement`: also read `tasks.md`, the diff, and any `review`
     output produced earlier on this hook event.

   Identify items that fall into one of these buckets:

   - **New knowledge** — something the project didn't have a node for that
     future work would benefit from knowing.
   - **Corrections** — a node that existed but was wrong, incomplete, or
     misleading. (You may have used such a node during recall and noticed
     the gap.)
   - **Gotchas / prior-incidents** — non-obvious failure modes that should
     be documented.

   If nothing rises to the bar, say so plainly and continue — a clean "no
   captures this phase" is a valid outcome.

2. **Propose changes to the human first.** For each candidate, present:

   ```markdown
   ## Capture Proposal — <after_plan | after_implement>

   ### New nodes to add
   - **`<proposed-loc>`** — <one-line description>
     Reason: <why this matters for future work>
     Content (preview): <2-3 lines>

   ### Existing nodes to update
   - **`<existing-loc>`** — <what is wrong / missing>
     Proposed change: <one-line description of the edit>

   ### Skipped (considered but not capturing)
   - <topic> — <one-line reason>
   ```

   Wait for the human to confirm which proposals to apply. Do not call
   `h-add-node` / `h-update-node` until they explicitly say to.

3. **Apply approved changes.**

   - For each approved new node, call `h-add-node` with `parentRel`, `name`,
     `description`, `content`, and tags appropriate to the project's tagging
     conventions.
   - For each approved update, call `h-update-node` with the existing `rel`
     and the corrected `content` and/or `description`. Set `reason` to a
     short reference to this spec (e.g. `"learned during specs/003-foo"`).

4. **Report what landed.** Tell the human exactly which nodes were created or
   updated, with their `loc`, so they can verify in the Hadron portal.

## Rules

- Always propose before writing. The human approves capture; the agent does
  not write to memory unilaterally.
- Don't capture spec-internal artefacts (the spec, plan, tasks themselves) —
  those live in `.specify/specs/<feature>/`. Capture the *generalizable*
  knowledge surfaced while building them.
- Don't write into `.specify/`. Capture writes go through Hadron MCP only.
- If Hadron MCP is not connected, surface the proposals to the human as a
  text block so they can be re-run later.
- A clean "no captures this phase" report is fine — don't invent material.

## Why

Without capture, every spec rediscovers the same lessons. The recall step
benefits from each prior capture; that is the loop. Capturing twice keeps
each pass scoped to fresh context and avoids the end-of-session memory
decay that loses earlier-session findings.
