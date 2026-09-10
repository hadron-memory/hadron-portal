// GraphQL operations for asset upload. v2 — memory-addressed surface
// per spec 006-asset-upload-redesign. Used by the portal's
// /api/assets/* server endpoints (not directly by client components —
// those go through $lib/api/assetUpload.ts).

// The shared per-asset projection. Declared FIRST: the consts below interpolate
// it at module-evaluation time, so a later declaration would be a TDZ error, not
// a hoisted reference.
//
// `uploadedBy` is a User id, NULL for a server-authored asset
// (hadron_store_file); `publicUrl` is the UNAUTHENTICATED hotlink and is null
// unless the asset is CLEAN, its memory unencrypted, and the server has a
// BASE_URL — so a caller must treat "no hotlink" as normal, not as an error.
export const ASSET_FIELDS = /* GraphQL */ `
  fragment AssetFields on Asset {
    id
    memoryId
    urn
    filename
    mimeType
    sizeBytes
    uploadedAt
    uploadedBy
    scanStatus
    # #707: the engine's signature name for a BLOCKED asset (hrn:node:hadronmemory.com:specs:cor:dmo:060:12).
    # BLOCKED is a terminal tombstone — the row is KEPT as the audit record and
    # the bytes are deleted — and the signature is the only thing on it that
    # says WHAT it was blocked as. Null for every other status, and null on a
    # BLOCKED row the scanner named nothing for, so a reader must treat its
    # absence as normal rather than as a missing verdict.
    scanSignature
    description
    publicUrl
  }
`;

export const BEGIN_ASSET_UPLOAD_V2_MUTATION = /* GraphQL */ `
  mutation BeginAssetUploadV2($input: BeginAssetUploadV2Input!) {
    beginAssetUploadV2(input: $input) {
      uploadId
      putUrl
      putHeaders { name value }
      expiresAt
      storageKey
      maxSizeBytes
      allowedMimeType
    }
  }
`;

// Returns the same projection the listing uses, so a freshly-uploaded asset can
// be prepended to a rendered list without a refetch.
export const COMPLETE_ASSET_UPLOAD_MUTATION = /* GraphQL */ `
  ${ASSET_FIELDS}
  mutation CompleteAssetUpload($input: CompleteAssetUploadInput!) {
    completeAssetUpload(input: $input) {
      ...AssetFields
      deletedAt
    }
  }
`;

// hadron-server#888 widened the gate from `uploadedBy = caller` to the holding
// memory's read access, so this now returns a colleague's files too, and
// run-created ones (uploadedBy NULL) at all. `mine` narrows to the caller's own
// uploads — a filter ON TOP of the read gate, not a substitute for it.
export const MEMORY_ASSETS_QUERY = /* GraphQL */ `
  ${ASSET_FIELDS}
  query MemoryAssets($memoryId: ID!, $mimeType: String, $skip: Int, $count: Int, $mine: Boolean) {
    memoryAssets(memoryId: $memoryId, mimeType: $mimeType, skip: $skip, count: $count, mine: $mine) {
      total
      hasMore
      assets {
        ...AssetFields
      }
    }
  }
`;

// hadron-server#895 (issue #891): the uniform CROSS-memory list, per
// hrn:node:hadronmemory.com:hadron-server:conventions:uniform-read-surface / spec hrn:node:hadronmemory.com:specs:cor:api:120 — `{ items, total }`, no
// `hasMore`. This is what makes portal#696's top-level Assets section possible;
// `memoryAssets` above stays the per-memory surface.
//
// The default scope IS the caller's accessible set, so the three tabs are
// FILTERS over one query, not three queries:
//   My files        → filter: { mine: true }
//   Available files → no filter
//   Org files       → orgId: <active org>
//
// Every AssetFilter field narrows; none widens. Two semantics worth remembering
// (hrn:node:hadronmemory.com:hadron-server:conventions:multi-ref-scope-args): unreadable/unknown `memoryRefs` are
// silently dropped while a MALFORMED urn throws, and an explicitly EMPTY
// memoryRefs list is the EMPTY scope — never a fallback to the default one.
export const ASSETS_QUERY = /* GraphQL */ `
  ${ASSET_FIELDS}
  query Assets($filter: AssetFilter, $orgId: ID, $limit: Int, $offset: Int) {
    assets(filter: $filter, orgId: $orgId, limit: $limit, offset: $offset) {
      items {
        ...AssetFields
      }
      total
    }
  }
`;

// hadron-server#888: attach an existing asset to the graph as a `reference`
// node whose data.asset points at it — the same shape hadron_store_file writes,
// so a reader never branches on how the file arrived. There is no schema-level
// Asset→Node link (hrn:node:hadronmemory.com:specs:cor:dmo:060:10 reserves it), so the pointer is soft and
// Node.asset resolves to null once the asset is gone.
export const CREATE_ASSET_REFERENCE_NODE_MUTATION = /* GraphQL */ `
  mutation CreateAssetReferenceNode($input: CreateAssetReferenceNodeInput!) {
    createAssetReferenceNode(input: $input) {
      id
      loc
      name
      nodeType
      memory { id urn }
    }
  }
`;

export const ASSET_DOWNLOAD_URL_QUERY = /* GraphQL */ `
  query AssetDownloadUrl($assetId: ID!, $ttlSeconds: Int) {
    assetDownloadUrl(assetId: $assetId, ttlSeconds: $ttlSeconds) {
      url
      expiresAt
      filename
      mimeType
      sizeBytes
    }
  }
`;

export const SOFT_DELETE_ASSET_MUTATION = /* GraphQL */ `
  mutation SoftDeleteAsset($assetId: ID!) {
    softDeleteAsset(assetId: $assetId) {
      id
      deletedAt
    }
  }
`;
