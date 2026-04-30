// GraphQL operations for asset upload. Used by the portal's /api/assets/*
// server endpoints (not directly by client components — those go through
// $lib/api/assetUpload.ts).

export const BEGIN_ASSET_UPLOAD_MUTATION = /* GraphQL */ `
  mutation BeginAssetUpload($input: BeginAssetUploadInput!) {
    beginAssetUpload(input: $input) {
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

export const SET_AGENT_ASSET_UPLOAD_ENABLED_MUTATION = /* GraphQL */ `
  mutation SetAgentAssetUploadEnabled($input: SetAgentAssetUploadEnabledInput!) {
    setAgentAssetUploadEnabled(input: $input) {
      id
      urn
      agentTools
    }
  }
`;
