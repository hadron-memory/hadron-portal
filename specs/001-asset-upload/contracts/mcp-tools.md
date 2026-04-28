# MCP Tool Contracts — Asset Upload

Three new MCP tools, all exposed by `hadron-server` and consumed by
`hadron-client`. Names are provisional (Constitution Invariant #5
allows renames as deprecation cycles once the platform-tools registry
brainstorm closes).

All tools authenticate via the existing App / AppKey path. All tools
respect the `asset:upload` entry in `App.agent_tools[]` for
agent-initiated invocations; `h-asset-list` and `h-asset-get-url` also
require the entry (you don't get to read the user's assets without
permission).

---

## h-asset-request-upload

Agent-initiated. Surfaces a file picker in the user's chat and waits
(or async-resolves) when the user picks / declines / cancels / times
out.

### Input

```json
{
  "prompt": "string (required, ≤500 chars) — what the agent wants",
  "allowedMimeTypes": ["string", "..."]   // optional; intersected with platform & agent allowlist
  "maxSizeBytes": "integer (optional, ≤ effective cap)",
  "timeoutSeconds": "integer (optional, default 600, ≤ effective timeout)"
}
```

### Output

```json
{
  "status": "uploaded" | "declined" | "cancelled" | "timeout",
  "assetId": "string (only when status='uploaded')",
  "filename": "string (only when status='uploaded')",
  "mimeType": "string (only when status='uploaded')",
  "sizeBytes": "integer (only when status='uploaded')",
  "reason": "string (declined / cancelled / timeout — short user-facing reason)"
}
```

### Errors

- `PERMISSION_DENIED:asset-upload-not-enabled` — agent's `agent_tools`
  doesn't include `asset:upload`.
- `INVALID_ARGUMENT:mime-types-empty-after-intersection` — every
  requested MIME type was filtered by the platform allowlist.
- `RATE_LIMITED` — too many concurrent upload requests for this user
  (per-user soft cap of 3 active requests).

### Side effects

- Emits `AppLogEntry` event_type=`asset`, operation=`upload-requested`.
- On `uploaded`: emits `upload-completed` log entry; creates the asset
  node.
- On other terminal statuses: emits the corresponding log entry; no
  node created.

---

## h-asset-list

List the calling user's assets in the current memory.

### Input

```json
{
  "parentRel": "string (optional, default 'assets')",
  "mimeType": "string (optional) — exact-match filter",
  "skip": "integer (optional, default 0)",
  "count": "integer (optional, default 20, max 100)"
}
```

### Output

```json
{
  "assets": [
    {
      "assetId": "string",
      "filename": "string",
      "mimeType": "string",
      "sizeBytes": "integer",
      "uploadedAt": "ISO-8601",
      "description": "string | null",
      "scanStatus": "pending | clean | blocked"
    }
  ],
  "total": "integer (total matching, before pagination)",
  "hasMore": "boolean"
}
```

### Errors

- `PERMISSION_DENIED:asset-tool-not-enabled` — `asset:upload` not in
  `agent_tools`.

### Side effects

- Emits `AppLogEntry` operation=`listed` with the count returned.
- Soft-deleted assets are excluded.

### Filtering

Per FR-014: results are scoped to the calling user. In multi-user
agents, another user's assets are never returned.

---

## h-asset-get-url

Mint a presigned GET URL for downloading an asset.

### Input

```json
{
  "assetId": "string (required)",
  "ttlSeconds": "integer (optional, default 300, max 300)"
}
```

### Output

```json
{
  "url": "string (presigned R2 GET URL)",
  "expiresAt": "ISO-8601",
  "filename": "string",
  "mimeType": "string",
  "sizeBytes": "integer"
}
```

### Errors

- `NOT_FOUND` — asset doesn't exist or is soft-deleted.
- `PERMISSION_DENIED:scan-status-pending` — scan hasn't run.
- `PERMISSION_DENIED:scan-status-blocked` — scan flagged the asset.
- `PERMISSION_DENIED:not-asset-owner` — calling user didn't upload
  this asset (multi-user agent).

### Side effects

- Emits `AppLogEntry` operation=`download-url-issued` with `ttlSeconds`.
- Decrypts `data.storageKey` on the request stack only; never cached.

---

## Tool gating (cross-cutting)

For each call to any of the three tools, the gating order is:

1. Authenticated App context (existing AppKey resolution).
2. App's `agent_tools[]` includes `asset:upload`.
3. Memory access via the layered access control
   (`Memory Access Control.md`): visibility → org membership →
   subscription role → agent subscription type → app role.
4. Per-user asset ownership (FR-014, asset list/get-url only).
5. scanStatus check (get-url only).

Failure at any layer returns the appropriate error code above. The
specific code is intentionally informative (`scan-status-blocked`
vs. `not-asset-owner`) rather than a generic `PERMISSION_DENIED`,
since the user's recovery action differs.
