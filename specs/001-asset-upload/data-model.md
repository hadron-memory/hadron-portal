# Phase 1 Data Model — Asset Upload Tool

Defines the shape of the asset node, edges, validator rules, encryption
boundaries, and storage-key derivation. The Prisma schema does NOT
gain new tables — assets ride the existing `Node` table with a new
`nodeType` value. Existing types (`AppLogEntry`, `AppKey`, etc.) are
unchanged in shape; only their valid value sets expand.

---

## E-001 — Asset node

A node with `nodeType: "asset"` representing one uploaded file.

### Storage location

- **Memory**: the chat session's resolved memory.
  - For multi-user agents: the requesting user's per-user memory under
    that agent (provisioned lazily on first upload).
  - For single-user agents: the agent's single memory.
- **Parent**: a node at `loc = "assets"` (`nodeType: "info"`),
  provisioned lazily on first upload using the existing parent-node
  upsert pattern.
- **Loc**: `assets:<assetId>` where `assetId` is a UUIDv7 generated
  server-side at upload-complete time.
- **URN** (computed): `<memory-urn>:assets:<assetId>`.

### Fields (Node row)

| Field | Type | Notes |
|-------|------|-------|
| `nodeType` | `"asset"` | New value; same `String` column. |
| `name` | string | Original filename (e.g. `business-plan.pdf`). |
| `loc` | `"assets:<assetId>"` | UNIQUE per memory. |
| `description` | string \| null | Optional, agent or user-supplied. |
| `content` | string \| null | RESERVED for content-extraction follow-up; null in v1. |
| `data` | JSON | See E-002. |
| `tags` | string[] | Optional; freeform. |
| `properties` | null | Not used by assets. |
| `seq` | int \| null | Default null; lists sort by `created_at` DESC. |
| `created_by` | fk User | Uploading user. |

### State machine

```
[upload requested]
       │
       │ (presigned URL minted; no node yet)
       │
[upload completed (HeadObject confirms)]
       │
       ▼
   active                             ◀───── restore
   data.scanStatus = "pending"
       │
       │ (scanner flips to clean | blocked)
       │
       ▼
   active (scanStatus = "clean")
       │
       │ user softDelete
       ▼
   soft-deleted
   data.deletedAt = now
   data.purgeAt   = now + 24h
       │
       │ janitor (purgeAt < now)
       ▼
   purged (R2 object deleted, node hard-deleted)
```

There is no explicit `replace` transition — replace == softDelete + new
upload.

---

## E-002 — Asset `data` shape

Validated at save time by `asset.validator.ts` when `nodeType === "asset"`.

```ts
type AssetData = {
  // identity & file metadata
  filename: string;          // 1..255 chars; original from user
  mimeType: string;          // RFC 6838; matches presigned policy
  sizeBytes: number;         // matches HeadObject Content-Length
  storageKey: string;        // R2 object key; encrypted at rest in encrypted memories

  // upload metadata
  uploadedAt: string;        // ISO-8601
  uploadedBy: number;        // User.id

  // optional
  description?: string;      // ≤ 1000 chars

  // virus-scan gate
  scanStatus: "pending" | "clean" | "blocked";
  scanCheckedAt?: string;    // ISO-8601; set by scanner

  // soft-delete
  deletedAt?: string;        // ISO-8601 when soft-deleted
  purgeAt?: string;          // ISO-8601; deletedAt + 24h
};
```

### Validator rules

The validator runs in `node.service.ts` upsert path:

1. If `nodeType === "asset"`: required keys present, types match, sizes
   in range. Required: `filename`, `mimeType`, `sizeBytes`, `storageKey`,
   `uploadedAt`, `uploadedBy`, `scanStatus`.
2. `mimeType` must be in the platform allowlist (defaults from
   `app.agent_mime_allowlist` if set; otherwise platform defaults).
3. `sizeBytes` ≤ effective cap (per-agent override OR platform default
   25 MB OR platform ceiling 100 MB — whichever is smaller).
4. `storageKey` must match the regex
   `^[a-z0-9.-]+/[a-z0-9-]+/[0-9a-f-]{36}\.[a-z0-9]+$` (i.e.
   `{orgUrn}/{memorySegment}/{uuid}.{ext}`).
5. `scanStatus` ∈ enum.
6. Cross-field: if `deletedAt` is set, `purgeAt` MUST be set and equal
   `deletedAt + 24h ± 60s`.

Validation failure rejects the upsert with a clear error code
(`ASSET_DATA_INVALID:<key>`). Same shape as the
`message.data.exception(s)` reservation from 001-edge-condition-spec.

### Encryption

In encrypted memories (`Memory.is_encrypted = true` — assumed pattern;
re-confirm during implementation against current Memory schema), the
`data.storageKey` field is encrypted with AES-256-GCM under
`HADRON_ENCRYPTION_KEY` using the existing per-node encryption helper.
All other fields are stored in plaintext (filename and size are not
secrets — the user explicitly named them).

Decryption happens once per request inside
`AssetService.mintDownloadUrl(assetId)` and the decrypted form lives only
on the request stack.

---

## E-003 — Edges that reference assets

No new edge primitive. Existing `Edge` table accepts these new label
values (label is a `string`, not enum):

| Label | Source | Target | Meaning |
|-------|--------|--------|---------|
| `has-image` | any node | asset node | Source uses this asset as its image (recipe → photo). |
| `has-attachment` | any node | asset node | Source has this asset as an attachment. |
| `attaches` | any node | asset node | Generic attachment relation. |
| `derived-from` | asset node | any node | This asset was derived from the target (e.g. screenshot of a topic). |
| `referenced-in` | asset node | any node | This asset is referenced in the target. |

Cross-memory references use `PendingEdge` with the target URN until the
asset memory is synced (existing pattern).

Soft-deleted assets remain edge-targets but the edge is filtered out of
default traversals (filter `target.data.deletedAt IS NULL`).

---

## E-004 — `App` extensions (no schema change)

Two existing `App` fields gain new conventions; no schema migration:

- `App.agent_tools[]` — adds the value `"asset:upload"` when the
  builder enables the upload tool. The MCP tool gating layer reads this
  array and refuses `h-asset-request-upload` calls when the value is
  absent.
- A new optional column-via-`properties`-JSON pattern (or an explicit
  column if existing patterns favor that) for per-agent overrides:
  - `app.properties.assets.maxSizeBytes`: ≤ platform ceiling (100 MB).
  - `app.properties.assets.allowedMimeTypes`: array of MIME types,
    intersected with platform allowlist.
  - `app.properties.assets.uploadRequestTimeoutSeconds`: default 600
    (10 min).

No changes to the `App`, `AppKey`, `AppAgent` Prisma shapes themselves.

---

## E-005 — `AppLogEntry` extensions (no schema change)

`AppLogEntry.event_type` gains a new conventional value: `"asset"`.
`AppLogEntry.detail` shape for asset events:

```ts
type AssetAuditDetail = {
  assetId: string;
  operation:
    | "upload-requested"
    | "upload-completed"
    | "upload-cancelled"
    | "upload-declined"
    | "upload-timeout"
    | "listed"
    | "download-url-issued"
    | "soft-deleted"
    | "restored"
    | "purged"
    | "scan-flipped";
  agentId: number;
  memoryId: number;
  userId: number;
  bytes?: number;       // upload-completed, purged
  ttlSeconds?: number;  // download-url-issued
  reason?: string;      // upload-cancelled / declined / timeout / scan-flipped
  scanStatusFrom?: string;  // scan-flipped only
  scanStatusTo?: string;    // scan-flipped only
};
```

---

## E-006 — Memory extensions (no schema change)

The `Memory` entity is unchanged. The `assets/` parent node is created
on demand in whichever memory the chat session resolves to. No new
columns required.

---

## E-007 — `NodeType` canonical list update

The `nodeType` column comment in `prisma/schema.prisma` updates from:

```prisma
nodeType    String    @default("info") @map("node_type")
// "info", "data", "task", "record", "chat", "plan", "parent"
```

to (matching the constitution v1.1.0 list):

```prisma
nodeType    String    @default("info") @map("node_type")
// "abstract", "asset", "info", "reference", "record", "system"
```

Note: the existing comment lists *historical* values that aren't actually
used today (`data`, `task`, `chat`, `plan`, `parent`); the constitution
authoritative list is the five-now-six in `Node-Types.md`. The plan
includes a task to clean up the comment alongside adding `asset`.

---

## E-008 — Storage key derivation

```
orgUrn          = memory.organization.urn   (e.g. "baragaun.com")
memorySegment   = memory.urn substring after "${orgUrn}:"
                  (e.g. "baragaun.com:secureid" → "secureid")
assetId         = uuidv7()
ext             = lower(extension(filename)); fallback "" if none
storageKey      = `${orgUrn}/${memorySegment}/${assetId}${ext ? "." + ext : ""}`
```

Constraint: `orgUrn` and `memorySegment` are validated against the
storage-key regex — an org URN that contains `/` (impossible per
Invariant #3) or other key-illegal characters would fail key
construction; the validator catches this at upsert time as defense in
depth.

---

## E-009 — Quotas (deferred, but reserved)

The spec deferred quota questions (per-user and per-agent storage caps).
The data model leaves room: a future migration can add nullable fields
on `App` (`assetsMaxBytes`, `assetsMaxCount`) and a per-org cap on
`Organization` (`assetsMaxBytes`). v1 leaves quotas unbounded; per-agent
size cap and MIME allowlist are the only enforced limits. Plan does
NOT include a v1 quota implementation task.

---

## Validation summary

| Layer | What is checked | Where |
|-------|----------------|-------|
| Pre-upload (presign) | User auth, agent permission, MIME/size against agent config | `asset.service.ts:mintPresignedPut` |
| Post-upload (complete) | HeadObject ETag exists, size matches, MIME matches | `asset.service.ts:completeUpload` |
| Save-time | `data` shape, storageKey regex, allowed MIME, size cap, deletedAt/purgeAt cross-field | `asset.validator.ts` (called from `node.service.ts` upsert) |
| Read-time | Layered access control + per-user scoping (FR-014) | `asset.service.ts:list`, `asset.service.ts:mintDownloadUrl` |
| Pre-download (URL mint) | scanStatus ∈ {clean}, deletedAt NULL, user/app scope match | `asset.service.ts:mintDownloadUrl` |
