---
name: "speckit-finalize"
description: "Verify a spec has fully shipped (all PRs merged, no orphans, no spec-corpus drift), prune local branches, mark Implemented in Entities.md."
argument-hint: "Optional spec ID (e.g. 005-agent-subscription); defaults to current feature"
compatibility: "Requires spec-kit project structure with .specify/ directory + gh CLI authenticated"
metadata:
  author: "spec-kit-health 2026-04-30"
  source: "specs/005-agent-subscription post-mortem"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## When to invoke

After the implementing PRs for a spec have been merged. This skill is the
end-of-spec verification step that closes the loose-ends-discovery gap that
existed before — instead of manually sweeping N repos to answer "is this
shipped?", run `/speckit-finalize`.

## Outline

1. **Resolve the spec**: Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root and parse `FEATURE_DIR`. The spec ID is the directory's basename (e.g., `005-agent-subscription`). If the user passed an explicit spec ID in `$ARGUMENTS`, use that instead.

2. **Find the spec's PRs across the org**: Run `.specify/scripts/bash/finalize-spec.sh --spec <spec-id>`. The script greps PRs across the GitHub org for branches whose name contains the spec ID, plus the spec ID's leading number, and returns JSON like:

   ```json
   {
     "spec_id": "005-agent-subscription",
     "prs": [
       {"repo": "hadron-server", "number": 69, "state": "MERGED", "title": "..."},
       {"repo": "hadron-server", "number": 70, "state": "MERGED", "title": "..."},
       {"repo": "hadron-portal", "number": 179, "state": "MERGED", "title": "..."},
       ...
     ],
     "open_count": 0,
     "merged_count": 4
   }
   ```

3. **Block if any open PRs remain**: If `open_count > 0`, list them and stop. The spec isn't done.

4. **Check for orphaned commits**: For each repo with merged PRs, verify the spec branch on origin doesn't have commits past its merged HEAD. The script does this via `git log origin/main..origin/<spec-branch>` for each named branch. If any are non-empty, list them and stop — orphans need either cherry-picking back into a fresh PR or explicit acknowledgement.

5. **Spec-corpus drift checklist** (manual confirmation step): Print a checklist for the user to confirm that the spec corpus on `main` describes what shipped:

   - Does `data-model.md` match the actual schema on `main` for each affected repo?
   - Do the entries in `contracts/*.md` match the shipped GraphQL schema, migration SQL, etc.?
   - Were there any `R-N reversal` blocks in implementation commits? If yes, did they propagate to `data-model.md` / contracts?

   If the user reports drift, **stop and ask them to fix it** — finalize doesn't proceed with known drift. Per Constitution Principle VI, the spec corpus on main MUST describe what shipped.

6. **Optional: prune local + remote branches**: After confirmation, delete local branches matching the spec ID (`git branch -D`) across repos listed in plan.md's "Repos & PRs" section. Remote branches are typically auto-deleted by squash-merge; warn if any remain.

7. **Mark spec as Implemented**: Update `hadron-concept/hadron-specs/General/Entities.md` (or wherever the entity ledger lives — the path is in `plan.md`'s "Docs Plan" section) to mark this spec as `Implemented`. If the spec frontmatter already says `Status: Implemented`, no-op.

8. **Clear soft-lock**: Remove this spec's entry from `.specify/active-work.json` if present.

9. **Report**: Print a concise summary — "Spec 005-agent-subscription finalized. 4 PRs merged across 3 repos. No orphans. Spec corpus on main matches shipped code. Local branches pruned."

## Important rules

- **Idempotent**: re-running `/speckit-finalize` on an already-finalized spec is safe — every step is a no-op or a confirming check.
- **Doesn't merge PRs**: this skill only verifies. Merging is still the human's decision.
- **Doesn't run health probes by default**: per-repo health probes (e.g., GHA workflow status) can be configured in `.specify/repo-config.yml` (out of scope for v1; document as a future hook).
- **Drift detection is manual in v1**: the script flags what to check; the user confirms. Real automated drift detection is a v2 concern.

## Pre-Execution Checks

**Check for extension hooks (before finalize)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_finalize` key.
- Apply the standard hook resolution rules (skip disabled, default to enabled if `enabled` is missing, skip non-empty `condition`s, dot-to-hyphen for command names).

If no hooks are registered or the file does not exist, skip silently.

## Post-Execution

**Check for extension hooks (after finalize)**:
- Check `.specify/extensions.yml` for `hooks.after_finalize` and apply the same rules.
- Suggested follow-up hook: a git tag at `spec-<id>-finalized` for traceability.
