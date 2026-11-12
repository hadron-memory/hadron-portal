# AI configuration browser checks

These scripts are author/test tooling, not product code or provider probes.

`test-ai-config-row-menu.mjs` mounts the real Manager/DataTable with synthetic rows and a stubbed read-only endpoint. It preserves enabled/disabled/mixed and 64-character-name cases at390/1280 in both themes, native pointer clicks before Edit and Delete, and both scroll extremes before each phone action. Desktop confirmation geometry is relative to its nearest cell; this is not a claim that scrollWidth alone detects ancestor clipping.

`test-ai-config-phone.mjs` requires your own fresh, deterministic `scripts/e2e/stack.sh` seed. Start that stack from a clean server checkout with DEV_LOGIN enabled by the stack, and serve this portal checkout at its recorded portal port. Supply:

- `AI_CONFIG_TEST_STACK`: your owned stack name.
- `AI_CONFIG_TEST_SERVER`: the server checkout containing that stack script.
- `AI_CONFIG_TEST_API` / `AI_CONFIG_TEST_PORTAL`: explicit loopback HTTP origins matching the stack's recorded ports.
- Optional `AI_CONFIG_TEST_SHOTS`: a fresh output directory, created recursively by the harness.

The guard verifies the stack's port records and runs its read-only seed check **before browser launch or writes**. Loopback alone is insufficient. Login is the synthetic seeded `alpha-admin@e2e.test`; the fixture owner is the deterministic e2e-alpha organization. No user lookup, real credentials, production, shared-dev DB or provider requests are permitted.

Each independent coarse-phone / fine-desktop context creates a uniquely named synthetic config and deletes only its returned, identity-verified ID in finally, including after a failed browser assertion. Any409 requires the exact matching pre-read and re-read ID/owner/name/provider/model; a borrowed config is never deleted. An unproved409 fails closed. Readback failure or changed identity refuses cleanup rather than deleting an unknown object; destroy the owned disposable stack afterwards even when the script fails.

A create whose outcome the harness cannot see (lost response, a non-200, or a 200 body that fails the identity check) may still have committed a row. When no config carried the fixture name before the create, the harness rereads and, if exactly one identity-verified row now carries it, owns and removes that row; any other result is left in place and reported as a cleanup diagnostic. A pre-existing row and any 409 are never reconciled this way. When the probe and the cleanup both fail, the thrown error carries both messages (an `AggregateError`, original probe error first) rather than letting the cleanup diagnostic replace the probe failure. Fixture names must be lower-case, because the server stores them canonical.

Set `AI_CONFIG_TEST_FAIL_AFTER_SETUP=1` for the deliberate post-create failure regression. Expect a nonzero exit with `Injected synthetic probe failure`, then verify through the same signed-in synthetic owner read that no `phone-check-` fixture remains. This is a failure-path test, not a successful UI run. The stack and preview remain the caller's resources and must be torn down in caller cleanup.

Phone320/390 and desktop1280 are separate browser contexts; the harness asserts actual coarse/fine pointer media, uses locator readiness rather than network-idle, and dismisses menus through a named heading instead of screen coordinates. Fresh and restored saved widths are separate assertions. No test sends the synthetic key to a provider.

The phone harness targets Vite dev specifically: Svelte client metadata on the exact control distinguishes hydrated controls from visible SSR markup. It then checks that control's connected expanded state. A production build does not promise this marker and is outside this harness's supported setup. Saved-view labels may be hidden on a phone, so attachment plus exact restored-header width is the readiness oracle.
