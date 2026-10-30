# QA final delta — hadron-portal#1411 at c0548602

- Portal SHA: `c05486020b80c12e25faccbd2e89c0c513a137c8`
- Server SHA: `3ed8383a866175112d37bcd2bd6c82c4750e9d46`
- Model/provider: Colette, QA Engineer; gpt-6-luna (OpenAI).
- At pickup: PR OPEN, non-draft, mergeable, head c0548602; all 9 required checks SUCCESS.
- Environment: private Incus disposable stack `colette1411f`; synthetic e2e fixtures; browser viewport 390×844, DPR 1; portal 19166 / server 19165.

## Delta QA results

1. PASS — Agent page loads at c0548602; manager editor is present and the new hint text is exact: “1 to 32 characters: a lowercase letter first, then lowercase letters, digits, “_” or “-”, for example “reviewer”. People who already have a removed role keep it.” This matches the server member-role grammar.
2. PASS — Human Team tab loads and remains selected through the merged page loader; role choices include the server-provided `owner` role. Agent and panel layouts both fit 390px without horizontal overflow.
3. PASS — reviewed fresh 390px light/dark captures of Agent page and Human Team panel.
4. CARRIED PASS from the immediately preceding c0cbaf24 QA delta (no relevant source change in these paths): keyboard removal moves focus to New role with polite announcement; duplicate Add preserves typed text and the consequence hint; empty union links to Agent and disables Add; non-manager action gets the FORBIDDEN-only permission copy. The c054 changes to the editor were copy-only; the main merge overlap in App loader was rerun above.
5. CARRIED PASS — focused Vitest 3 files / 25 tests on c0cbaf24 and stack health/fixture checks on c054. CI at c054 was 9/9 green at pickup.

## Limits and cleanup

No complete portal suite was rerun locally on c054; CI was green. No manager mutation was submitted at c054 because the task requested carry-over except the Agent page and members panel merge paths. Private stack and local portal process stopped; temporary worktrees/scratch removed. Only synthetic fixture data appeared in captures.
