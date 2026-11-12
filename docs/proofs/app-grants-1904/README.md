# App Grants author UI checks (#1904)

These screenshots contain only synthetic data from an owned disposable stack, not production account data. They show the real App Grants route at 1280px and 390px, using the actual Theme menu to select Light/Dark.

The author ran the built portal against hadron-server `2755d34ad` in a fresh `scripts/e2e/stack.sh` instance, signing enabled. The fixture's platform action registry was initialized through the existing `upsertPlatformActions` helper; this E2E seed does not run the deployment upsert automatically. No grant was signed or activated, no provider called, and no production data used. The built portal runs with development cookie settings and an explicit loopback ORIGIN for HTTP; this is not a production deployment claim.

Checks: choose a worker and a node with the existing node/memory pickers; create an unsigned grant; confirm revoke with Cancel focused; show the returned row inline; repeat revoke and retain its timestamp; filter and restore the row without losing that returned timestamp; Search-Enter sends no write. Non-manager discovery is covered by mounted navigation tests; a real non-manager direct-route check was denied. Initial signing-off stack checks verified that Create is absent; list/revoke independence is also pinned by route tests.

The platform limit recorded by Victor in team chat #101935 is preserved: a null USER lookup without `holderDepartedAt` does not prove deletion. It displays the neutral holder fallback. No signature or passkey credential id is requested or shown.


## Combined fix author check

The refreshed screenshots show collapsed node name/URN and created time, plus the plain revoke outcome. A fresh built-portal run on the same server commit verified the native reason limit (2001 ASCII code points rejected without a POST; 2000 supplementary Unicode characters accepted by the form), node identity, and fresh/repeated revoke feedback with an unchanged returned timestamp. The server's reason validator independently counts Unicode code points (`src/lib/grants/create.ts`); the portal action uses the same metric and a specific refusal.

The outsider, visitor and beta-admin fixtures each received the same fixed 404 message for an existing App and a missing App; readable alpha-member remained a fixed 403. These checks used only the owned disposable fixture, which was torn down afterwards. Initial signing-off browser evidence predates the fix; the unchanged off-path and new node enrichment are unit-pinned, with independent delta QA still required.
