# Phase 0 Research — Asset Upload Tool

Consolidates the resolved decisions from the brainstorm
(`2026-04-28-asset-upload-design/summary.md`) plus the few additional
technology choices surfaced during planning. There were no
[NEEDS CLARIFICATION] markers in the spec, so most of this is reaffirmation
plus the implementation-level details the spec deliberately leaves open.

---

## R-001 — Storage backend

**Decision**: Cloudflare R2, accessed via `@aws-sdk/client-s3` against the
R2 S3-compatible endpoint.

**Rationale**: Settled in brainstorm 002-hs (S3 and GCS out for
non-technical reasons). Free egress matters once chat previews and the
future content-extraction follow-up start fetching bytes. The S3-compatible
API means the same client library works against R2 with only an endpoint
override; we keep our existing code patterns.

**Alternatives considered**: Backblaze B2, on-prem MinIO, DigitalOcean
Spaces — none clear the bar for a fourth provider given the brainstorm's
explicit "high-bar" rule for departing from R2.

---

## R-002 — Upload path

**Decision**: Direct browser-to-R2 via presigned PUT URL.

**Rationale**:

- Keeps multi-megabyte files out of the SvelteKit/Apollo request path
  (recurrent operational hazard otherwise).
- Server pre-signs a `PutObject` URL after authenticating the user against
  the agent + memory. The presigned policy pins:
  - `Content-Length-Range` (max-size guard, derived from agent override or
    platform default 25 MB).
  - `Content-Type` (must be in agent's MIME allowlist).
- Browser PUTs the bytes; on `200 OK` the client calls a small
  `assetUploadComplete(uploadId)` mutation. Server `HeadObject`s the key,
  confirms size and MIME match the presigned policy (defense against a
  client that lies about what it uploaded), and only then writes the asset
  node.

**Alternatives considered**: Proxy-through-server upload — rejected for
operational reasons (large-file passthrough through Node.js + Apollo is the
kind of thing that surfaces in outage post-mortems).

**Sub-decisions**:

- **CORS rule**: One bucket-level CORS config per environment, allowlisting
  the portal origin (e.g. `https://app.hadronmemory.com`) and
  `dev.localhost:5173` for local dev. `PUT` and `HEAD` allowed; expose
  `ETag`.
- **Presigned URL TTL**: 5 minutes for upload PUT (matches the GET TTL in
  SC-005 — uniform expiry is easier to reason about than two TTLs).

---

## R-003 — Bucket layout & key shape

**Decision**: One bucket per environment
(`hadron-assets-{prod|staging|dev}`); object keys
`{orgUrn}/{memoryUrnSegment}/{assetId}.{ext}`.

**Rationale**: Aligns with R2's bucket count limits and the existing
tenancy patterns (per-org isolation through key prefix + signed-URL scope).
Bucket-per-org doesn't scale beyond ~1000 customers and adds operational
overhead (CORS-per-bucket, lifecycle-per-bucket).

**Key shape details**:

- `orgUrn`: the owning Organization URN (domain name), already a stable
  identifier.
- `memoryUrnSegment`: the part of the memory URN after the org segment
  (e.g. for `baragaun.com:secureid` it's `secureid`). Avoids encoding the
  full URN twice.
- `assetId`: server-generated UUIDv7 (matches Node ID convention from
  Entities.md).
- `.ext`: file extension preserved from the user's filename for content-
  type sniffing convenience; never user-controlled in the key path itself.

**Alternatives considered**: Per-org buckets (rejected, see above);
flat `{assetId}.{ext}` keys with no tenancy prefix (rejected — makes
tenant-aware lifecycle policies harder).

---

## R-004 — Encryption

**Decision**:

- **App layer**: `data.storageKey` on the asset node is encrypted with
  AES-256-GCM under `HADRON_ENCRYPTION_KEY` for nodes in encrypted
  memories. Reuses the existing per-node encryption helper
  (same pattern as `Memory.source_token_encrypted`,
  `App.ai_api_key_encrypted`). Decrypted only at request time to mint a
  presigned GET; never cached past the request.
- **Storage layer**: R2 SSE-S3 (provider-managed keys) by default for
  v1. Adequate for v1 use cases (business plans, recipe photos,
  receipts). Customer-managed keys are an explicit non-goal and a
  follow-up spec.

**Rationale**: Constitution Invariant #7 mandates AES-256-GCM under
`HADRON_ENCRYPTION_KEY` for sensitive credentials and storage-access
references. The asset's `storageKey` IS the storage-access reference for
encrypted memories; encrypting it is the right level of protection.

**Alternatives considered**: Customer-managed keys (deferred — needed for
HIPAA tier customers); per-asset symmetric keys derived via HKDF (over-
engineered for v1).

---

## R-005 — Credential management

**Decision**: R2 access keys live in env vars per environment
(`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`,
`R2_BUCKET_NAME`). Rotation is a redeploy.

**Rationale**: Single set of platform-level credentials per env is the
simplest model. The constitution's amendment-and-add-rotatable-credentials
table can come later when we need per-org buckets (Invariant #11 supports
either approach).

**Alternatives considered**: A `StorageBucket` table with encrypted
credentials editable via portal (deferred — needed only when we offer
customer-managed buckets).

---

## R-006 — Memory shape: `asset` as a NodeType

**Decision**: `asset` is added as a sixth NodeType. See plan
Constitution Check Invariant #2 for the amendment procedure.

**Rationale**: Brainstorm 005-rs.md established three concrete reasons:

1. No good slot in the existing five NodeTypes (`info` pollutes search,
   `record` hides assets in the tree, `reference` is taken).
2. Symmetry with `reference` — same shape (root parent, one node per
   resource, metadata in `data`, optional content in `content`,
   URN-addressable cross-memory).
3. Cheapest moment to type is now (zero asset nodes in production); type
   migration later costs more.

The Prisma column for `nodeType` is a `String` (not enum), so adding the
value is a comment update plus type-aware-dispatch code. No DB migration.

**Alternatives considered**: Convention-only with save-time validator
(rejected — brainstorm 005-rs.md). `Memory.assets` as a separate Prisma
relation outside the graph (rejected in brainstorm 004-cc.md — loses graph
integration).

---

## R-007 — Cross-references: edges, not URN strings in `data`

**Decision**: A node that references an asset (e.g. a recipe pointing at
its image) does so via a directed edge with a descriptive label
(`has-image`, `attaches`, `derived-from`). Same edge primitive as
citations from the references work. URN strings in `data` remain valid
only for cross-memory references where edges aren't expressible.

**Rationale**: Bidirectional traversal ("which recipe uses this image?"),
soft-delete semantics through the existing edge mechanism, portal can
render asset usage without scanning every node's `data` for URN-shaped
strings. cc's argument in brainstorm 004 stands; was kept independent of
the typing question.

**Reserved edge labels** for asset relationships (initial set; extensible):
`has-image`, `has-attachment`, `attaches`, `derived-from`, `referenced-in`.

---

## R-008 — Per-user vs. agent-wide assets

**Decision**: Assets live in the user's per-user memory under multi-user
agents; in the agent's single memory under single-user agents. The
`assets/` parent node is provisioned lazily on first upload, mirroring the
existing per-user memory provisioning pattern from `startChat`.

**Rationale**: Multi-user agents (Juno-style) need per-user isolation
because users shouldn't see each other's uploads (FR-014, SC-007).
Single-user agents (Mealplan-style) only have one memory, so the question
doesn't arise.

**Implementation note**: The asset service resolves the target memory by
asking the chat session which memory it's anchored to — that resolution
already exists for the per-user-memory pattern in agent chat.

---

## R-009 — Permissions model

**Decision**: Opt-in per agent. Stored as a string entry in
`App.agent_tools[]` (the existing field) with the value
`asset:upload`. Default: empty array → no upload tool available.

**Rationale**: Matches the pattern for the email tool. Builder-controlled,
not platform-default. Constitution Principle V (Zero-Trust Apps) requires
external-data tools to be opt-in.

**Surface**: A toggle in the agent edit page in hadron-portal under "Tool
permissions" — adds/removes the `asset:upload` value in `agent_tools`.

**Alternatives considered**: Default-on (rejected — every agent gains an
upload affordance the builder didn't ask for); per-org default (rejected —
unnecessary additional layer for v1).

---

## R-010 — Tool naming & registry coupling

**Decision**: Provisional MCP names `h-asset-request-upload`,
`h-asset-list`, `h-asset-get-url`. Final names track the platform-tools
registry brainstorm
([`hadron-concept/brainstorming/2026-04-21-registering-platform-tools/`](../../../hadron-concept/brainstorming/2026-04-21-registering-platform-tools/)).

**Rationale**: Constitution Invariant #5 requires `h-<verb>-<noun>` shape
— provisional names conform. Renames from the registry outcome are handled
as deprecation cycles per Invariant #5's "Tool names are stable contracts"
clause.

**Concrete contracts** in [`contracts/mcp-tools.md`](./contracts/mcp-tools.md).

---

## R-011 — Virus-scan gate

**Decision**: Build the gate in v1, not the scanner.

- New asset nodes default `data.scanStatus = "pending"`.
- `h-asset-get-url` and the GraphQL `assetDownloadUrl` resolver refuse to
  mint a URL when `scanStatus` ∈ `{ pending, blocked }`. They return a
  reason; clients render "scanning…" or "blocked" UI accordingly.
- Upload-complete callback enqueues a notification (logged as a
  `pending-scan` `AppLogEntry`); the actual queue infrastructure is a
  follow-up.

**Rationale**: SC-006/SC-007 don't require a scanner; FR-013 requires the
gate. Building the gate now lets the scanner land later as a worker that
flips `scanStatus` from `pending` to `clean`/`blocked` without touching
the rest of the system.

**Implementation hook**: Server exposes an internal-only mutation
`asset.setScanStatus(assetId, status)` callable by a future worker process
authenticated with a service-class App credential.

---

## R-012 — Audit logging

**Decision**: Every asset operation emits an `AppLogEntry` with
`event_type: "asset"` (new value to add to the Entities.md spec) and
structured `detail`:

- `assetId`, `operation` (`upload-requested`, `uploaded`,
  `upload-cancelled`, `upload-declined`, `upload-timeout`, `listed`,
  `download-url-issued`, `soft-deleted`, `restored`, `purged`), `userId`,
  `appId`, `agentId`, `memoryId`, `bytes` (for upload/purge), `error?`.
- For encrypted memories, the `assetId` is logged but not the underlying
  filename or storage key.

**Rationale**: Principle V requires logging tool invocations. The existing
`AppLogEntry` shape supports this without schema changes; only the
`event_type` enum needs the `asset` value.

---

## R-013 — Soft delete and recovery window

**Decision**: User-initiated delete sets `data.deletedAt = <ISO>` and a
companion `data.purgeAt = deletedAt + 24h`. The asset disappears from
user-facing list queries (filter `deletedAt IS NULL`). A daily janitor
process:

- Deletes R2 objects whose corresponding node has `purgeAt < now()`.
- Hard-deletes the node after the R2 object is gone.

**Rationale**: FR-008 requires a 24h recovery window; the simplest model
is two timestamps and a janitor. R2 lifecycle rules can't be used here
because the recovery window is measured from soft-delete time, not from
upload time.

**Restore**: An admin (anyone with `OrgMember.role >= ADMIN` on the
owning org) can clear `deletedAt` and `purgeAt`, returning the asset to
the user's view. The restore endpoint is a server-side admin tool only,
not exposed via MCP or the portal user UI in v1.

**Alternatives considered**: R2 versioning + lifecycle to manage
recovery (rejected — couples retention policy to bucket config; more
moving parts than a janitor).

---

## R-014 — Build/test infrastructure

**Decision**:

- **Server**: Jest with `pg-mem` for unit tests; testcontainers PostgreSQL
  for integration; `aws-sdk-client-mock` for R2 calls in unit tests; a
  local MinIO container for integration tests against a real S3-API
  endpoint. Existing patterns.
- **Portal**: Vitest + Svelte Testing Library for component tests;
  Playwright for the full upload e2e (requires a running server +
  MinIO).
- **MCP contract tests**: shell-driven via the existing
  `hadron-client` test harness; one fixture per `h-asset-*` tool.

**Rationale**: Reuses existing test infrastructure. MinIO is already used
by the team for other S3-API testing.

---

## Open follow-ups (non-blocking for v1)

These do not gate v1 ship:

- **Tool naming finalization** when the platform-tools registry brainstorm
  closes. Deprecation-cycle rename if needed.
- **Virus scanner implementation** (R2 → Cloudflare Worker pattern likely;
  separate spec).
- **Customer-managed encryption keys** (HIPAA tier; separate spec).
- **Content extraction** (PDF text, image OCR; separate spec — fills the
  asset node's `content` field).
- **Asset versioning** beyond one-step replace (separate spec).
- **Cross-user / cross-agent asset sharing** (separate spec).
