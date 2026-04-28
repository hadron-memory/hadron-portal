# HTTP Endpoints — Asset Upload

The direct browser → R2 PUT flow needs no new HTTP endpoints in
`hadron-server` beyond what GraphQL already exposes — the presigned PUT
URL itself is the upload endpoint, served by R2.

This document catalogs the HTTP surface for completeness and notes
which Cloudflare-side configuration is required.

---

## Server-side endpoints

None new. All asset operations from the portal happen via GraphQL
mutations/queries documented in [graphql.md](./graphql.md):

- `beginAssetUpload` → returns the presigned URL.
- `completeAssetUpload` → server confirms upload via R2 HeadObject.
- `agentAssets`, `assetDownloadUrl`, `softDeleteAsset`, `restoreAsset`,
  `setAgentAssetUploadEnabled`.

The MCP tools in [mcp-tools.md](./mcp-tools.md) similarly use the
existing MCP transport; no new HTTP endpoints are required.

---

## Cloudflare R2 configuration

### Bucket

- Name: `hadron-assets-{prod|staging|dev}`.
- Region: auto (closest Cloudflare datacenter; R2's default).
- Public access: **disabled**. All access via presigned URLs.
- Server-side encryption: SSE-S3 (default; provider-managed keys).
- Lifecycle rules: none in v1 (soft-delete is server-driven via the
  janitor, not bucket lifecycle).

### CORS rules

Single rule per environment, allowlisting the portal origin:

```json
[
  {
    "AllowedOrigins": [
      "https://app.hadronmemory.com",
      "https://staging.app.hadronmemory.com",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length",
      "x-amz-date",
      "x-amz-content-sha256",
      "x-amz-meta-asset-id",
      "Authorization"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The exact origin list is environment-specific; staging/dev origins are
present only in non-prod buckets. CORS origin per env is wired at
deploy time.

### Access keys

Generated in Cloudflare R2 dashboard, scoped to the single bucket per
env. Stored in server env:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME` (per-env: `hadron-assets-prod` etc.)

The S3-compatible endpoint URL is derived as
`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.

### IAM/permissions

R2 access keys are bucket-scoped (per Cloudflare R2's permissions model).
Required permissions:

- `s3:PutObject` (for presigned PUT)
- `s3:GetObject` (for presigned GET)
- `s3:HeadObject` (for upload-complete confirmation)
- `s3:DeleteObject` (for soft-delete janitor)

No `s3:ListBucket` required — the server tracks its own object list
via the `Node` table.

---

## Direct browser-to-R2 PUT request

Issued by the portal client after `beginAssetUpload` returns a ticket:

```http
PUT {putUrl} HTTP/1.1
Host: {accountId}.r2.cloudflarestorage.com
Content-Type: {agreed mime type}
Content-Length: {agreed bytes}
{additional headers from putHeaders[]}

{file bytes}
```

Successful response:

```http
HTTP/1.1 200 OK
ETag: "{md5-or-sha-style etag}"
```

The client retains the `ETag` and sends it (optional) in the
`completeAssetUpload` mutation for stronger validation. The server's
`HeadObject` call also returns the ETag, so this is defense-in-depth.

### Error responses

R2 returns S3-style XML error responses for failures:

| HTTP status | Cause | Client action |
|-------------|-------|---------------|
| 400 | Mismatched Content-Length / Content-Type | Surface "upload mismatch" error; user retries. |
| 403 | Presigned URL expired or signature invalid | Re-call `beginAssetUpload`. |
| 413 | Body too large (per policy) | Surface size-cap error. |

The client wraps R2 error parsing in a thin helper — no need to import a
full S3 client on the browser side; the SvelteKit upload helper uses
`fetch()` with `signal` for cancel.

---

## Cancellation

The browser aborts via `AbortController.signal`. R2 doesn't have a
"cancel partial upload" API for single-PUT (multipart uploads do, but
v1 caps at 25 MB which is below the multipart threshold). Partial bytes
in the bucket from aborted uploads:

- Are never referenced by an asset node (because `completeAssetUpload`
  was never called).
- Get reaped by a daily janitor that lists keys with no corresponding
  active node and deletes them after a 24h grace period.

The janitor is the same one that hard-deletes purged assets (R-013 in
research.md); orphan-key cleanup is one extra pass.
