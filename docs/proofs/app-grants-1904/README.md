# App Grants author UI checks (#1904)

These screenshots contain only synthetic data from an owned disposable stack, not production account data. They show the real App Grants route at 1280px and 390px, using the actual Theme menu to select Light/Dark.

The author ran the built portal against hadron-server `2755d34ad` in a fresh `scripts/e2e/stack.sh` instance, signing enabled. The fixture's platform action registry was initialized through the existing `upsertPlatformActions` helper; this E2E seed does not run the deployment upsert automatically. No grant was signed or activated, no provider called, and no production data used. The built portal runs with development cookie settings and an explicit loopback ORIGIN for HTTP; this is not a production deployment claim.

Checks: choose a worker and a node with the existing node/memory pickers; create an unsigned grant; confirm revoke with Cancel focused; show the returned row inline; repeat revoke and retain its timestamp; filter and restore the row without losing that returned timestamp; Search-Enter sends no write. Non-manager discovery is covered by mounted navigation tests; a real non-manager direct-route check was denied. Initial signing-off stack checks verified that Create is absent; list/revoke independence is also pinned by route tests.

The platform limit recorded by Victor in team chat #101935 is preserved: a null USER lookup without `holderDepartedAt` does not prove deletion. It displays the neutral holder fallback. No signature or passkey credential id is requested or shown.
