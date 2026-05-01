// GraphQL operations for asset upload. v2 — memory-addressed surface
// per spec 006-asset-upload-redesign. Used by the portal's
// /api/assets/* server endpoints (not directly by client components —
// those go through $lib/api/assetUpload.ts).

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

export const COMPLETE_ASSET_UPLOAD_MUTATION = /* GraphQL */ `
  mutation CompleteAssetUpload($input: CompleteAssetUploadInput!) {
    completeAssetUpload(input: $input) {
      id
      memoryId
      urn
      filename
      mimeType
      sizeBytes
      uploadedAt
      uploadedBy
      description
      scanStatus
      deletedAt
    }
  }
`;

export const MEMORY_ASSETS_QUERY = /* GraphQL */ `
  query MemoryAssets($memoryId: ID!, $mimeType: String, $skip: Int, $count: Int) {
    memoryAssets(memoryId: $memoryId, mimeType: $mimeType, skip: $skip, count: $count) {
      total
      hasMore
      assets {
        id
        memoryId
        filename
        mimeType
        sizeBytes
        uploadedAt
        scanStatus
        description
      }
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
