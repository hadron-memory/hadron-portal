---
description: "Apply project review-criteria nodes from Hadron memory to the implementation diff."
---

# Review Implementation Against Hadron Review-Criteria Nodes

Pull the project's review-criteria from the Hadron Graph and apply each one
to the changes produced by `/speckit-implement`. This is a *project-specific*
review pass — separate from Spec Kit's `/speckit-analyze` cross-artifact check.

## When this runs

Invoked as an `after_implement` hook (configurable in
`.specify/extensions.yml`). Run this **after** the implementation has produced
a diff and **before** capture / commit.

## What to do

1. **Locate the review-criteria node.** The project keeps a designated review
   node in Hadron memory. Resolution order:

   1. If the project has documented a specific `loc` for the review node
      (e.g. in the spec's plan or in a project-level config), use that.
   2. Otherwise call `h-find-nodes` with `query: "review criteria"` (and
      project-specific terms if available) and pick the highest-quality hit
      whose tags include `review` or `review-criteria`.

   If no review-criteria node is found, report that to the human and stop —
   do not invent criteria.

2. **Read the criteria.** Call `h-read-node` on the resolved `loc`. Treat the
   content as the canonical checklist for this project.

3. **Apply each criterion to the diff.** For each criterion:

   - State the criterion verbatim (or paraphrased succinctly).
   - Cite the file/line in the implementation diff that bears on it.
   - Mark **pass** / **fail** / **n/a** with a one-line reason.

   Don't grade aesthetic preferences — only what the criteria explicitly say.

4. **Surface follow-ups.** Anything that fails becomes an actionable item the
   human can address before commit. Include them as a bulleted list under
   `## Follow-ups`.

5. **Report to the human.** Output:

   ```markdown
   ## Hadron Review — applied criteria from <node-loc>

   | # | Criterion | Result | Notes |
   |---|-----------|--------|-------|
   | 1 | …         | pass   | …     |
   | 2 | …         | fail   | …     |

   ## Follow-ups
   - <action item if any criterion failed>
   ```

## Rules

- Read-only with respect to Hadron memory and `.specify/`. This command does
  not call `h-add-node` / `h-update-node` and does not modify any files in
  `.specify/`.
- Apply *only* the criteria from the review node. If you think a different
  criterion should apply, propose it to the human as a candidate for the
  capture step — but do not enforce it here.
- If Hadron MCP is not connected, abort with a clear message.

## Why

Spec Kit's `/speckit-analyze` checks cross-artifact consistency — does the
plan match the spec, do tasks match the plan. The Hadron review node holds
*project quality criteria* that `/speckit-analyze` doesn't know about
(security conventions, performance requirements, naming rules, prior-incident
guards). Both checks are useful and they're not substitutes.
