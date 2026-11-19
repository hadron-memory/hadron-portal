# Boot prompt tab workflow (#1485)

Author evidence from the real portal at this branch, signed in through dev login
against a disposable e2e server stack built from hadron-server main (`544c68db`).
The Agent is the e2e-alpha `coordinator`; its source was started with "Start a
source" on the tab. Themes come from the app's own `localStorage.theme` switch.
No production system was touched.

States, in the order they were produced on that one Agent:

| Files | Viewer | State |
|---|---|---|
| `outdated-*` | manager | Source revision 2 saved on the source node page (opened from step 1), then **Refresh**: revision 1 is approved, and `RECOMPILE_AVAILABLE` shows the outdated warning with nothing pending. |
| `nonmanager-outdated-*` | plain member | Same moment: the intro and steps, no Compile and no outdated warning. |
| `pending-*` | manager | After **Compile**: revision 2 is ready but not approved; Approve panel in step 4. |
| `nonmanager-pending-*` | plain member | Same moment: no Compile, no Approve. |
| `approved-*` | manager | After **Approve**: "Revision 2 is approved and ready to serve." |

Each state is shown at 1280px and 390px in light and dark. No layout reported
horizontal overflow at either width.
