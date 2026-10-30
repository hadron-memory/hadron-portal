# QA delta — hadron-portal#1411 at c0cbaf24

- Portal SHA: `c0cbaf2431d1d31eb7e451379528c30f14ccbe76`
- Server SHA: `3ed8383a866175112d37bcd2bd6c82c4750e9d46`
- PR state before receipt: OPEN, non-draft, mergeable; all 9 required checks green.
- Capture author/model: Colette, QA Engineer; gpt-6-luna (OpenAI).
- Environment: private disposable Incus stack `colette1411d`, synthetic e2e fixtures. Browser viewport 390×844, DPR 1. Portal 19156, server 19155.

## Results

1. PASS — after keyboard removal of the final `owner` chip, focus moves to the `New role` input; polite `role=status` announces “Removed owner. 0 roles left.” The empty-list validation blocks Save.
2. PASS — duplicate Add keeps typed `owner`, displays “owner is already in the list”, and keeps the lowercase/digits/hyphens + removed-role consequence hint visible.
3. PASS — 390px dark and light manager captures plus keyboard removal capture reviewed. Human Team and empty-union layouts fit 390px without horizontal overflow.
4. PASS — empty role union displays guidance linked to the `coordinator` Agent and disables Add member. The beta App's two Agent role policies were set empty in this disposable DB while keeping their AppAgent joins; stack was later destroyed.
5. PASS — as `multi-app`, POSTing the hidden updateMemberRoles action received HTTP 403 and the permission-specific copy: “The roles were not saved. Changing them needs the Agent’s owner or an organization admin.”
6. PASS — focused Vitest: 3 files, 25 tests passed; includes BAD_USER_INPUT, FORBIDDEN, internal requestId, and unknown-error retry cases. The e2e stack health/fixture checks passed.

Captures: manager light/dark at 390px, keyboard removal at 390px, duplicate Add at 390px, Human Team at 390px, empty-union at 390px. All fixtures are synthetic.

## Limits and cleanup

No real tenant/data; no production browser leg. One first unit-test invocation lacked generated `.svelte-kit` config and failed to collect tests; after `svelte-kit sync`, all 25 tests passed. The temporary pnpm 11 `allowBuilds` settings were only in this disposable server worktree and will be reverted. Private Incus stack and local portal server will be stopped and worktrees removed.
