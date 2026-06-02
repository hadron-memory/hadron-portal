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
