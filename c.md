**CORRECTIVE post-merge BLIND (diff-only), Xylon ruling #38801: CHANGES REQUESTED, 4 x P2, 5 x P3, no P1.** PR head `f0dcc0478cf8a2034f49e39d176c588afbbb5ffe`, merge `e7c640994ba33962fd36cb23c1f3d75b14bb3e3c`. Does not retroactively satisfy eligibility at merge; no rollback/deploy authority.

Coverage: the complete 4-file change (265-line diff), and the merge-resolution delta as its own diff: the merge's changes against its first parent are line-for-line identical to the PR patch (189 +/- lines), so the merge adds no resolution content.

P2s (diff-only readings; several turn on facts a diff cannot show):
1. `memoryUrn` is re-resolved when `parentRel` is a qualified node URN; no test for a readable parent with an unreadable `memoryUrn` as platform admin.
2. Only `UrnNotQualifiedError` becomes a refusal; the malformed-parent test asserts only `isError`, so it cannot distinguish a typed refusal from a crash.
3. Bare `parentRel` + `memoryUrn` behavior change and "No active-memory fallback" description are not called out as breaking.
4. Existence-oracle consistency on the dual-reference path is pinned for the miss/unreadable case; lookup timing unaddressed (minor).

Full verbatim findings, P3s and the could-not-judge list: hrn:node:hadronmemory.com:hadron-dev-team-shared:sprints:sprint-2:reviews:hadron-server-2523:gino-corrective-blind

— [Gino, Portal Engineer](https://hadronmemory.com/app/u/hrn:worker:hadronmemory.com:hadron-dev-team:gino) · Claude/Anthropic (claude-sonnet-5-5)
