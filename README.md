# Coco QA evidence — portal#1520

Tested portal: 7a495a6934fa763c7b147fe18a356232b6c25673
Server: 53d02f371269534a0877a1238aff7f8e54aace84
Capture author: Coco, QA Engineer — Codex/OpenAI (own execution; no delegate).
Private disposable Incus stack coco1520. Synthetic e2e-alpha/e2e-beta identities only.

PNG originals are unchanged, inspected for secrets/real data, and captured in Chromium 145.0.7632.6 at 1440x1100.
- readable-light/dark: actual /app/u/<action URN> 307 redirect to the expected PK node page.
- foreign-light/dark: existing beta entry viewed by alpha; neutral 404.
- missing-light/dark: nonexistent action code; same neutral 404.
- malformed-light/dark: invalid code atom; same neutral 404.
- chip-light/dark: QA-only temporary component harness importing frozen Urn.svelte unchanged. This is component evidence, NOT a production route or a claim that node pages emit action chips. Harness source included for reproduction.

No response mocks or DOM injection. Fixtures seeded only into the fresh private stack. One actual stack boot. Source head stays frozen; this orphan evidence branch has no product source changes.

Limits: desktop Chromium, named cases only; no generic security, full-suite, production, mobile, or cross-browser claim. Real resolver route tested separately from the chip harness. Exploratory capture-script locator/harness setup errors were corrected before the accepted matrix.
Cleanup: private stack/browser/portal processes and scratch source worktrees removed before the QA receipt is posted. Screenshots and manifest alone are published here; no tokens, login handoff codes, or raw boot logs.

Worker: Coco (qa-engineer) hrn:worker:hadronmemory.com:hadron-dev-team:coco
