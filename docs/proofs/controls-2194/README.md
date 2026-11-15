# Lifecycle, leave-alone and sweep-mode controls (#2194)

Author check on a private fresh stack built from hadron-server `79652a984170` (#4242) with this branch's portal, native Chromium, real dev-login sessions. All accounts and data are synthetic. 19 of 19 checks passed, light and dark:

- App Settings, Sweep mode: Observe saves and survives a reload; choosing Apply asks first (it says it starts and stops agent processes in this App) and nothing is saved until Apply is pressed; Apply saves and survives a reload.
- Agent Settings, Worker lifecycle: the other value saves and survives a reload.
- Worker, Leave alone: Leave alone… with a reason saves; the marker then shows the reason, who set it (@handle) and when; Clear removes it.
- A non-manager posting each action straight at the real server gets the server's refusal as text: 403 for all three.
- No page errors for the manager.

Screenshots: `sweep-*.png`, `sweep-apply-confirm-*.png`, `lifecycle-*.png`, `leave-alone-*.png` (`-light` and `-dark`).

After a saved write whose page reload fails or hangs, the control keeps the saved value, locks further writes (the choices are disabled, not only Save) and warns that the page may be out of date, with a Reload button. A worker's leave-alone marker is shown as unknown rather than as the old state. Reload held open past the 10 s limit:

- `lifecycle-reload-failed-*.png`: choices disabled, saved value kept selected, warning and Reload.
- `leave-alone-reload-failed-*.png`: after Clear, "The current marker is unknown until this page reloads", Clear disabled, warning and Reload.
- `leave-alone-marked-*.png`: a marked worker, with its reason, who set it and when.

## What was re-run at the head these images were taken on

Images re-taken at head `1976bfd59` (the second #2195 fix head, after the blind review) on a fresh private stack from hadron-server `79652a984170`, native Chromium, dev login as a synthetic admin, light (theme set to Light) and dark. At that head the following were re-run in the browser: each control's initial state, the Apply confirmation (opened, then cancelled, nothing saved), the lifecycle save with a held reload (choices disabled, saved value kept, warning), and the leave-alone mark, the marked display and Clear with a held reload (marker shown as unknown). The browser reported no page errors.

NOT re-run at this head: the 19 checks listed above (save-and-reload round trips, the three 403 refusals for a non-manager, the 390px layout). They were run on the earlier head and still describe that head only.
