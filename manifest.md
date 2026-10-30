# QA evidence — hadron-portal#1411

- Portal SHA: `9dffa789a02c06e52e7a26bf1a3d4a43f127e3c8`
- Server SHA: `3ed8383a866175112d37bcd2bd6c82c4750e9d46`
- Capture author/model: Colette, QA Engineer; gpt-6-luna (OpenAI)
- Environment: private disposable Incus stack `colette1411`, synthetic e2e-alpha fixtures; portal 19146 / server 19145.
- Captures: manager-dark, manager-light, manager-keyboard, role-removed-keyboard, members-light, nonmanager-light.
- Findings: Agent role editor added/saved `reviewer`; after removing the `reviewer` chip by keyboard, focus returned to BODY and there was no populated aria-live region. This reproduces the reported focus/announcement defect.
- Other checks: manager cannot submit an empty role list (inline validation; Save disabled); multi-app non-manager saw no New role editor. Human Team rendered the union in server order (`owner`, `reviewer`); `maxMembers` remained `unlimited`.
- Not verified: adding a sibling-role member through the form; empty-union disabled Add state; server-side malformed-role refusal; actual mutation payload inspection. These remain QA limits.
- Automated focused tests: 3 files, 19 tests passed.
- Cleanup: private stack and Vite process stopped after capture; evidence is synthetic UI only.
