# Task priority and blockers — author evidence

Refs #1352. Synthetic data only, native signed-in portal against a disposable
Incus stack. Server pinned to merged S1 `cf9bcfece3e6fc1d12fd6caf82a50c941035680a`.
These are author checks; they do not replace the independent QA seat.

- Created priority 3 with two selected blockers, in one create mutation; API read
  confirmed priority, both relations, and the server `blocked` flag.
- Changed priority to 5 through the native form; API read confirmed persistence.
- Removed one blocker: still blocked. Removed the last: unblocked, no status or
  assignee rewrite by the portal.
- Picker Escape closes the dialog and restores focus to its opener, in both themes.
- Browser page errors: none. At 390px, document horizontal overflow: false.
- Exact lookup selects through the same-App authorized read. Wider paging and
  stale/unmount response isolation also have mounted component tests.

The complete gate matrix (finish/cancel release, crafted refusals, authority
revocation, >200 native choices, concealment and unchanged action/tree/filter
controls) remains for independent native browser/API QA at the frozen head.

## Screenshots

| Surface | Light | Dark |
| --- | --- | --- |
| Create | [1280px](create-1280-light.png) | [1280px](create-1280-dark.png) |
| Picker | [1280px](picker-1280-light.png) | [1280px](picker-1280-dark.png) |
| Detail with two blockers | [1280px](detail-1280-light.png) | [1280px](detail-1280-dark.png) |
| Detail after last blocker removed | — | [390px](detail-390-dark.png) |

The shared TaskHandle component is copied byte-for-byte from Gaia's portal#1375
head `6e3dbd42bbe59d137641a58779f4370740a60848` at the same path. No second handle
renderer or task-search provider is introduced. Fresh-main overlap is checked
before freeze; merge main, never rebase, if the companion lands first.
