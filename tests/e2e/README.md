# Synthetic API-key browser chain (#226)

`pnpm test:api-key-chain` uses the existing Playwright 1.58.2 Chromium dependency.
It drives the actual `/app/account/api-keys` route and its server actions, with
an actual locally mounted hadron-server GraphQL/MCP application and Postgres.
No route interception or mocked mint/revoke response is used.

## Run

1. Check out hadron-server at the exact commit in `server-revision.txt` into a
   separate directory. Install its locked dependencies and generate its Prisma
   client (`pnpm install --frozen-lockfile`, `pnpm db:generate`).
2. Have local Postgres with pgvector available and a role allowed to create/drop
   databases. Set `HADRON_E2E_DATABASE_URL` to its maintenance database URL (only
   loopback endpoints are accepted). No application database is read or reused.
3. Install portal dependencies, run `pnpm exec svelte-kit sync`, and install
   Chromium (`pnpm exec playwright install chromium`).
4. Run `HADRON_E2E_SERVER_DIR=/absolute/server/checkout pnpm test:api-key-chain`.

The runner rejects a different server HEAD and a checkout containing `.env`. CI checks out the same pinned commit
and uses a dedicated pgvector Postgres service. Updating the pin requires changing
both `server-revision.txt` and the workflow checkout ref and reviewing the new
server behavior. The fixture uses `prisma db push` against its new empty database;
this is not migration/deployment certification.

## Fixture and assertions

The established server integration-test auth convention is used: create a
synthetic CONTRIBUTOR and sign a JWT for it, then inject `hadron_token` into the
isolated browser context. This tests an authenticated session, not a login
provider, passkey ceremony, or OAuth flow. The user has an `.invalid` email.
Credentials pass over child-process IPC only; no login code is captured to disk.

The test mints through the UI, reads the one-shot reveal, clicks Copy and checks
the context's clipboard. It initializes actual HTTP MCP with that Bearer and
executes `hadron_whoami`. It then opens the row menu, confirms Revoke, verifies a
**new** MCP initialize request returns 401, checks the revoked row, and verifies
reload removes the raw reveal. Existing-session revocation is outside this test.

The test starts Vite and the backend on ephemeral loopback ports. Backend
service/provider environment is a clean allowlist; external fetch is rejected.
There are no real-provider calls, tunnels, production users or keys.

## Secret containment and cleanup

No screenshots, traces, videos, HTML dumps, storage-state files, HTTP payloads or
raw exception messages are recorded. Backend stdout/stderr are discarded, portal
console output is suppressed (GraphQL errors can contain credentials), and only
fixed stage failures or a success/version summary are emitted. The raw key and
fixture JWT stay in memory; clipboard is cleared and browser context closed.

A unique owned database and graph directory are created per invocation. `finally`,
SIGINT/SIGTERM and the three-minute deadline close the browser/servers, delete the
synthetic keys/user when possible, force-drop that database, and remove the graph
scratch directory. A host crash/SIGKILL cannot execute process cleanup; any
`portal_keys_<20 hex>` database remaining after one is a disposable owned fixture,
not an application database. CI service teardown provides an additional boundary.

## Sensitivity evidence

The implementation run separately proved these source mutations fail, restoring
both afterwards:

- Removing `RawKeyReveal`'s `onclick={copyKey}` fails at `copy raw reveal`.
- Returning the owned key without revoking it in the pinned server's
  `revokeUserApiKey` resolver fails at `fresh revoked request` (actual MCP still
  accepts it). This is distinct from a failed UI button test.

The restored chain passed with Chromium 145.0.7632.6 on Linux/Node 22.23.3.
Independent QA uses the coordinator-authorized Sonnet-class pool; this author
receipt is not that independent execution or a full runtime/OAuth certification.
