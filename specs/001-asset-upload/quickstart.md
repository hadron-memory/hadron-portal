# Quickstart — Asset Upload Tool

End-to-end developer walkthrough for testing the asset upload feature
locally. Assumes you already have the standard hadron-server +
hadron-portal local dev environment running.

---

## 1. Prerequisites

- `hadron-server` checked out, dependencies installed, PostgreSQL
  reachable, Prisma migrations applied.
- `hadron-portal` checked out, dependencies installed.
- Docker (for MinIO; substitutes for R2 in local dev).
- An existing dev Organization, Agent, and App with an AppKey — the
  same artifacts you'd use to test chat.

---

## 2. Start a local R2-compatible bucket (MinIO)

```bash
docker run -d --name hadron-r2 \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=hadron-dev \
  -e MINIO_ROOT_PASSWORD=hadron-dev-secret \
  minio/minio server /data --console-address ":9001"

# Create the bucket
docker exec hadron-r2 mc alias set local http://localhost:9000 hadron-dev hadron-dev-secret
docker exec hadron-r2 mc mb local/hadron-assets-dev

# Apply CORS for local portal
docker exec hadron-r2 mc anonymous set none local/hadron-assets-dev   # belt + suspenders
docker exec hadron-r2 mc admin policy create local hadron-assets-dev-policy /tmp/policy.json   # see policy below
```

CORS for local dev (substitute MinIO console at :9001 to apply visually
or use `mc admin` policy attachment):

```json
{
  "AllowedOrigins": ["http://localhost:5173"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type", "Content-Length", "x-amz-date", "x-amz-content-sha256", "Authorization"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}
```

---

## 3. Configure the server

Add to `hadron-server/.env`:

```bash
R2_ACCOUNT_ID=minio-local
R2_ACCESS_KEY_ID=hadron-dev
R2_SECRET_ACCESS_KEY=hadron-dev-secret
R2_BUCKET_NAME=hadron-assets-dev
R2_ENDPOINT_OVERRIDE=http://localhost:9000   # MinIO substitution; not used in prod
```

`HADRON_ENCRYPTION_KEY` is already in the server env from the existing
LLM API key + GitHub token patterns. The same key is used for asset
storage-key encryption.

Restart the server.

---

## 4. Apply the constitution amendment + spec updates

The plan amends the constitution to v1.1.0 and updates docs. After
checking out branch `001-asset-upload` in each repo:

- `hadron-portal/.specify/memory/constitution.md` — v1.1.0 (adds `asset`
  to Invariant #2's NodeType list).
- `hadron-concept/hadron-specs/Features/Node-Types.md` — adds an
  `asset` row.
- `hadron-server/prisma/schema.prisma` — `nodeType` column comment
  updated to reflect six valid values.

These are documentation/comment updates only; no DB migration runs.

---

## 5. Opt the agent into the upload tool

Two options:

### From the portal (preferred)

1. Open `http://localhost:5173/agents/<your-agent-urn>/edit`.
2. Under **Tool permissions**, toggle **"Allow asset upload"** on.
3. Save.

This calls `setAgentAssetUploadEnabled` which adds `asset:upload` to the
App's `agent_tools[]`.

### From the database (faster for testing)

```sql
UPDATE apps
SET agent_tools = array_append(agent_tools, 'asset:upload')
WHERE urn = '<your-agent-urn>';
```

---

## 6. Exercise User Story 1 (agent-prompted upload)

1. Open a chat with the agent in the portal.
2. Ask the agent something that prompts it to need a document. Either:
   - Use a prompt template you control, e.g. "Ask the user to upload a
     business plan."
   - Call the MCP tool directly via `hadron-client`:

     ```bash
     hadron-client invoke h-asset-request-upload \
       --prompt "Please upload your business plan" \
       --allowedMimeTypes application/pdf \
       --maxSizeBytes 5242880
     ```
3. The portal chat surfaces a file picker labeled with the prompt.
4. Pick a small PDF.
5. Watch the upload progress bar; on completion, the file appears as a
   chip in the message thread.

Behind the scenes:

- Browser calls `beginAssetUpload(...)` → server mints presigned PUT.
- Browser PUTs bytes to MinIO at `http://localhost:9000/...`.
- Browser calls `completeAssetUpload(uploadId)` → server `HeadObject`s
  the key, validates, writes the asset node.
- MCP tool call resolves with `{ status: "uploaded", assetId, ... }`.

Verify in the database:

```sql
SELECT loc, name, data->'mimeType' AS mime, data->'sizeBytes' AS bytes,
       data->'scanStatus' AS scan
FROM nodes
WHERE node_type = 'asset'
ORDER BY created_at DESC
LIMIT 5;
```

---

## 7. Exercise User Story 2 (browse + download)

1. Open `http://localhost:5173/agents/<your-agent-urn>` (the agent
   detail page).
2. The **Assets** section lists your uploaded PDF.
3. Click the filename. The portal calls `assetDownloadUrl(assetId)` and
   redirects to the presigned GET URL. The PDF downloads.

In dev, scanStatus stays `pending` because no scanner is running. The
download is gated behind `clean` in production. To unblock for local
testing, manually flip the status:

```sql
UPDATE nodes
SET data = jsonb_set(data, '{scanStatus}', '"clean"')
WHERE loc = 'assets:<your-asset-id>';
```

(Or, for development convenience, the server can be started with
`HADRON_ASSET_SCAN_AUTO_CLEAN=true` to bypass the gate. Configure in
`server/.env` for dev only — never set in production.)

---

## 8. Exercise User Story 3 (agent retrieval)

1. In a fresh chat with the same agent, prompt it to look up the prior
   upload. Or call directly:

   ```bash
   hadron-client invoke h-asset-list --count 5
   ```

2. The response includes the asset from Story 1.

3. Get a download URL:

   ```bash
   hadron-client invoke h-asset-get-url --assetId <id>
   ```

   Response includes a 5-minute presigned URL.

---

## 9. Exercise User Story 5 (delete + recover)

1. From the agent detail page, click delete on the asset.
2. Confirm. The asset disappears from the list.
3. Restore (admin-only, no portal UI in v1) via direct mutation:

   ```graphql
   mutation { restoreAsset(assetId: "<id>") { id deletedAt } }
   ```

   Run as a user with `OrgMember.role >= ADMIN`.

4. The asset reappears in the list.
5. To exercise purge, manually advance the purgeAt timestamp:

   ```sql
   UPDATE nodes
   SET data = jsonb_set(data, '{purgeAt}', to_jsonb((now() - interval '1 second')::text))
   WHERE loc = 'assets:<your-asset-id>';
   ```

   Then run the janitor (`yarn server janitor:assets` — added in this
   feature). The R2 object is deleted; the node is hard-deleted.

---

## 10. Run tests

From each repo's root on branch `001-asset-upload`:

```bash
# hadron-server
yarn test                                  # unit + integration
yarn test:integration --grep "asset"       # asset-only

# hadron-portal
yarn test                                  # Vitest component tests
yarn test:e2e --grep "asset"               # Playwright

# Optional contract test from hadron-client
hadron-client test --suite asset-upload
```

All asset tasks in `tasks.md` pair with one of these test suites
(Principle I).

---

## 11. Common dev-time gotchas

- **CORS errors on PUT**: MinIO CORS not applied or origin missing.
  Re-apply policy and check browser console.
- **HeadObject 404 on completeAssetUpload**: presigned PUT didn't
  actually land — check the bucket via `mc ls local/hadron-assets-dev`.
  Often a clock skew between browser and MinIO container.
- **`scanStatus` stuck on `pending`**: dev convenience flag not set;
  flip manually or set `HADRON_ASSET_SCAN_AUTO_CLEAN=true`.
- **Cross-user list returns nothing**: in a multi-user agent, you must
  be the user who uploaded the asset. Switch portal session to the
  uploader to see the asset.
- **Agent doesn't surface the file picker**: `asset:upload` not in
  `App.agent_tools`. Re-toggle in the portal or update the row.
