# Lifecycle, leave-alone and sweep-mode controls (#2194)

Author check on a private fresh stack built from hadron-server `79652a984170` (#4242) with this branch's portal, native Chromium, real dev-login sessions. All accounts and data are synthetic. 19 of 19 checks passed, light and dark:

- App Settings, Sweep mode: Observe saves and survives a reload; choosing Apply asks first (it says it starts and stops agent processes in this App) and nothing is saved until Apply is pressed; Apply saves and survives a reload.
- Agent Settings, Worker lifecycle: the other value saves and survives a reload.
- Worker, Leave alone: Leave alone… with a reason saves; the marker then shows the reason, who set it (@handle) and when; Clear removes it.
- A non-manager posting each action straight at the real server gets the server's refusal as text: 403 for all three.
- No page errors for the manager.

Screenshots: `sweep-*.png`, `sweep-apply-confirm-*.png`, `lifecycle-*.png`, `leave-alone-*.png` (`-light` and `-dark`).
