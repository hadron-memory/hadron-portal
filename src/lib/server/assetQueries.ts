// GraphQL operations for asset upload. Used by the portal's /api/assets/*
// server endpoints (not directly by client components — those go through
// $lib/api/assetUpload.ts).

export const BEGIN_ASSET_UPLOAD_MUTATION = /* GraphQL */ `
  mutation BeginAssetUpload(
    $agentUrn: String!
    $filename: String!
    $mimeType: String!
    $sizeBytes: Int!
    $description: String
    $uploadIntent: AssetUploadIntent!
    $uploadRequestId: String
  ) {
    beginAssetUpload(
      agentUrn: $agentUrn
      filename: $filename
      mimeType: $mimeType
      sizeBytes: $sizeBytes
      description: $description
      uploadIntent: $uploadIntent
      uploadRequestId: $uploadRequestId
    ) {
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
  mutation CompleteAssetUpload($uploadId: String!) {
    completeAssetUpload(uploadId: $uploadId) {
      id
      assetId
      loc
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

export const AGENT_ASSETS_QUERY = /* GraphQL */ `
  query AgentAssets($agentUrn: String!, $mimeType: String, $skip: Int, $count: Int) {
    agentAssets(agentUrn: $agentUrn, mimeType: $mimeType, skip: $skip, count: $count) {
      total
      hasMore
      assets {
        id
        assetId
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
  query AssetDownloadUrl($assetId: String!, $ttlSeconds: Int) {
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
  mutation SoftDeleteAsset($assetId: String!) {
    softDeleteAsset(assetId: $assetId) {
      id
      deletedAt
    }
  }
`;

export const RESTORE_ASSET_MUTATION = /* GraphQL */ `
  mutation RestoreAsset($assetId: String!) {
    restoreAsset(assetId: $assetId) {
      id
      deletedAt
    }
  }
`;

export const SET_AGENT_ASSET_UPLOAD_ENABLED_MUTATION = /* GraphQL */ `
  mutation SetAgentAssetUploadEnabled($agentUrn: String!, $enable: Boolean!) {
    setAgentAssetUploadEnabled(agentUrn: $agentUrn, enable: $enable) {
      id
      agentTools
    }
  }
`;
