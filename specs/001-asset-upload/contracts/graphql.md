# GraphQL Contracts — Asset Upload

Mutations and queries surfaced by `hadron-server` for the portal's
upload UI. The MCP layer wraps these for agent-initiated calls.

---

## Types

```graphql
type Asset {
  id: ID!
  assetId: String!          # UUIDv7 portion of the loc
  loc: String!              # "assets:<uuid>"
  urn: String!              # computed memory URN + ":" + loc
  filename: String!
  mimeType: String!
  sizeBytes: Int!
  uploadedAt: DateTime!
  uploadedBy: User!
  description: String
  scanStatus: AssetScanStatus!
  deletedAt: DateTime        # null for active
}

enum AssetScanStatus {
  PENDING
  CLEAN
  BLOCKED
}

type AssetUploadTicket {
  uploadId: String!         # opaque server-generated id (UUIDv7)
  putUrl: String!           # presigned R2 PUT URL
  putHeaders: [HttpHeader!]!  # required headers (Content-Type, x-amz-meta-*)
  expiresAt: DateTime!
  storageKey: String!       # echoed back for client display only; NOT a secret
  maxSizeBytes: Int!
  allowedMimeType: String!
}

type HttpHeader {
  name: String!
  value: String!
}

type AssetDownloadUrl {
  url: String!
  expiresAt: DateTime!
  filename: String!
  mimeType: String!
  sizeBytes: Int!
}

type AssetListResult {
  assets: [Asset!]!
  total: Int!
  hasMore: Boolean!
}
```

---

## Queries

```graphql
extend type Query {
  """
  Lists assets in the caller's accessible memory for an agent.
  Per-user-scoped in multi-user agents. Soft-deleted assets excluded.
  """
  agentAssets(
    agentUrn: String!
    mimeType: String
    skip: Int = 0
    count: Int = 20
  ): AssetListResult!

  """
  Mint a presigned GET URL for downloading an asset.
  ttlSeconds defaults to 300, capped at 300.
  Errors:
    - NOT_FOUND
    - SCAN_PENDING
    - SCAN_BLOCKED
    - PERMISSION_DENIED
  """
  assetDownloadUrl(
    assetId: String!
    ttlSeconds: Int = 300
  ): AssetDownloadUrl!
}
```

---

## Mutations

```graphql
extend type Mutation {
  """
  Step 1 of upload: server pre-signs a PUT URL.
  - uploadIntent='user': unprompted, paperclip flow.
  - uploadIntent='agent-request': in response to h-asset-request-upload.
    Requires uploadRequestId so the server can correlate completion with
    the in-flight tool call.
  """
  beginAssetUpload(
    agentUrn: String!
    filename: String!
    mimeType: String!
    sizeBytes: Int!
    description: String
    uploadIntent: AssetUploadIntent!
    uploadRequestId: String         # required when intent='agent-request'
  ): AssetUploadTicket!

  """
  Step 2: client signals upload completion. Server HeadObject's the key,
  validates size/MIME match the policy, persists the asset node, and
  returns the resulting Asset.
  """
  completeAssetUpload(uploadId: String!): Asset!

  """
  User-initiated soft delete. Sets deletedAt + purgeAt.
  """
  softDeleteAsset(assetId: String!): Asset!

  """
  Admin-only. Clears deletedAt + purgeAt before the janitor purges.
  Returns null if the asset has already been purged.
  """
  restoreAsset(assetId: String!): Asset

  """
  Per-agent permission toggle (builder-facing).
  enable=true adds 'asset:upload' to App.agent_tools.
  enable=false removes it.
  """
  setAgentAssetUploadEnabled(
    agentUrn: String!
    enable: Boolean!
  ): App!
}

enum AssetUploadIntent {
  USER
  AGENT_REQUEST
}
```

---

## Auth & error mapping

All resolvers run through the existing App/User context middleware.
Permission failures map to GraphQL `extensions.code` values:

| Code | Cause |
|------|-------|
| `UNAUTHENTICATED` | No valid context. |
| `PERMISSION_DENIED` | Failed agent_tools or memory access check. |
| `NOT_FOUND` | Asset id doesn't exist (also for soft-deleted in user-facing queries). |
| `SCAN_PENDING` | `scanStatus = pending`. |
| `SCAN_BLOCKED` | `scanStatus = blocked`. |
| `INVALID_INPUT` | Validator rejected the data shape. |
| `SIZE_EXCEEDED` | Requested `sizeBytes` > effective cap. |
| `MIME_NOT_ALLOWED` | Requested `mimeType` not in effective allowlist. |

---

## Subscriptions (stretch — out of scope for v1)

If we add live UI updates later, candidates:

- `assetUploadProgress(uploadId)` — server-side observed progress.
- `assetScanStatusChanged(assetId)` — fired when the scanner flips
  status.

Out of scope for v1; the portal polls with a short interval after
`completeAssetUpload` and after open scanStatus=`pending` is rendered.
