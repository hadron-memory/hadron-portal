---

description: "Task list for asset upload feature implementation across hadron-server, hadron-portal, hadron-docs, hadron-concept"
---

# Tasks: Asset Upload Tool

**Input**: Design documents from `/specs/001-asset-upload/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE)
overrides the speckit default. Every implementation task pairs with a
test task.

**Organization**: Grouped by user story (P1 → P3) so each story can be
shipped as an MVP slice independently.

## Format: `[ID] [P?] [Story] Description`

- `[P]` — parallelizable (different files, no dependency on incomplete tasks).
- `[Story]` — `US1`–`US5` map to spec.md user stories. Setup, Foundational, and Polish phases have no story label.
- File paths are absolute from each repo's root.

## Path Conventions (multi-repo)

- `hadron-server/` — server-side TypeScript + Prisma + tests.
- `hadron-portal/` — SvelteKit components, GraphQL ops, tests.
- `hadron-docs/` — MkDocs reference page.
- `hadron-concept/` — entity ledger + Node-Types spec + brainstorm refs.
- `hadron-portal/.specify/memory/` — constitution.

### Path corrections after codebase survey

The original draft assumed `hadron-server/src/modules/asset/...` — the
actual codebase uses a flatter layout. Tasks below use the corrected paths:

- Libraries live at `hadron-server/src/lib/asset/` (mirrors
  `src/lib/edge-conditions/`).
- R2 client lives at `hadron-server/src/integrations/r2/` (mirrors other
  `src/integrations/<provider>/` modules).
- Per-operation logic lives at
  `hadron-server/src/controller/operations/<verbNoun>.ts` (e.g.
  `beginAssetUpload.ts`, `completeAssetUpload.ts`) — one file per
  operation, called from resolvers.
- GraphQL schema/resolvers extend the existing central
  `hadron-server/src/api/graphql/schema/typeDefs.ts` and `resolvers.ts`
  in place. Resolver tests for this feature go in a new file
  `hadron-server/src/api/graphql/schema/resolvers.assetUpload.test.ts`.
- MCP `h-asset-*` tools register inside the existing
  `hadron-server/src/mcp/server.ts` (single file with all `h-*` tools);
  contract tests in `hadron-server/src/mcp/server.assetUpload.test.ts`.
- Janitor job lives at `hadron-server/src/jobs/janitorAssets.ts`.
- Tests are co-located inline as `*.test.ts` (Vitest), not under a
  separate `tests/` tree.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Constitution amendment, NodeType canonicalization, R2 wiring.

- [ ] T001 Amend `hadron-portal/.specify/memory/constitution.md` from v1.0.0 → v1.1.0: add `asset` to Invariant #2's NodeType list (six values). Update Sync Impact Report at top of file. Bump `Last Amended` to 2026-04-28.
- [ ] T002 Update `hadron-concept/hadron-specs/Features/Node-Types.md`: add row for `asset` (search priority: not searched / explicit `nodeType` filter only; tree visibility: shown).
- [ ] T003 [P] Update `hadron-server/prisma/schema.prisma`: change the `nodeType` line comment to `// "abstract", "asset", "info", "reference", "record", "system"` (replaces stale historical values).
- [ ] T004 [P] Add R2 env vars to `hadron-server/.env.example` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT_OVERRIDE` for dev/MinIO).
- [ ] T005 [P] Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to `hadron-server/package.json`; install.
- [ ] T006 [P] Create `hadron-server/src/modules/asset/` directory with empty placeholder files for `asset.service.ts`, `asset.validator.ts`, `asset.resolver.ts`, `asset.mcp.ts`, `r2.client.ts`, `index.ts`. Same in `hadron-server/tests/unit/asset/` and `tests/integration/asset/`.
- [ ] T007 [P] Add MinIO compose service to `hadron-server/docker-compose.yml` (or local dev script per existing patterns) with bucket `hadron-assets-dev` plus CORS for `http://localhost:5173`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core asset module skeleton + access control + audit logging that every user story depends on.

⚠️ CRITICAL: No user-story phase begins until Phase 2 is complete.

- [ ] T008 Implement R2 client wrapper in `hadron-server/src/modules/asset/r2.client.ts`: `mintPutUrl({ key, contentType, contentLength, ttlSeconds })`, `mintGetUrl({ key, ttlSeconds })`, `headObject({ key })`, `deleteObject({ key })`. Reads creds from env. Honors `R2_ENDPOINT_OVERRIDE` for MinIO.
- [ ] T009 [P] Unit tests for `r2.client.ts` in `hadron-server/tests/unit/asset/r2.client.test.ts` using `aws-sdk-client-mock`. Cover: presign happy path, content-length policy clause, head-object 404 error mapping.
- [ ] T010 Implement save-time validator in `hadron-server/src/modules/asset/asset.validator.ts`: invoked from `node.service.ts` upsert path when `nodeType === "asset"`. Enforces required keys, MIME allowlist, size cap, storageKey regex, scanStatus enum, deletedAt/purgeAt cross-field rules. Errors as `ASSET_DATA_INVALID:<key>`.
- [ ] T011 [P] Wire validator into `hadron-server/src/modules/node/node.service.ts` upsert (single-line dispatch on nodeType).
- [ ] T012 [P] Unit tests for validator in `hadron-server/tests/unit/asset/asset.validator.test.ts`. Each rule (required-key absent, MIME blocked, size > cap, key regex mismatch, deletedAt without purgeAt) gets one negative test plus one positive test.
- [ ] T013 [P] Implement `hadron-server/src/modules/asset/asset.audit.ts` helper: `logAssetEvent({ operation, assetId, agentId, memoryId, userId, appId, detail? })` that writes an `AppLogEntry` with `event_type: "asset"`. Operation enum from data-model.md E-005.
- [ ] T014 [P] Unit tests for `asset.audit.ts` in `hadron-server/tests/unit/asset/asset.audit.test.ts`.
- [ ] T015 [P] Extend `hadron-server/src/modules/auth/access-control.ts` with `isAssetVisibleToCaller(asset, callerCtx)` adding the per-user-uploader scope (FR-014) on top of the existing five-layer check. Multi-user agent: only the uploader sees the asset.
- [ ] T016 [P] Unit tests for the per-user asset scope in `hadron-server/tests/unit/auth/asset-access.test.ts`.
- [ ] T017 [P] Implement assets-parent-node provisioning helper in `hadron-server/src/modules/asset/assets-parent.ts`: `ensureAssetsParent(memoryId)` upserts a node at `loc = "assets"` (`nodeType: "info"`). Idempotent.
- [ ] T018 [P] Unit tests for `ensureAssetsParent` in `hadron-server/tests/unit/asset/assets-parent.test.ts`.
- [ ] T019 [P] Codegen GraphQL fragments in `hadron-portal/src/lib/api/asset.gql.ts` for `Asset`, `AssetUploadTicket`, `AssetDownloadUrl`, `AssetListResult` types per [contracts/graphql.md](./contracts/graphql.md). Run `yarn codegen`.

**Checkpoint**: Foundation ready — Stories US1–US5 can begin.

---

## Phase 3: User Story 1 — Agent-prompted upload (Priority: P1) 🎯 MVP

**Goal**: An agent can request a file upload from the user; the user picks a file; it stores in R2 and persists as an asset node. Round-trip completes, agent sees the result.

**Independent test**: Configure a dev agent with `asset:upload`, run `hadron-client invoke h-asset-request-upload --prompt "Upload your business plan"`, pick a small PDF in the portal chat, confirm the asset node exists in DB and the tool call resolves with `status: "uploaded"`.

- [ ] T020 [US1] Implement GraphQL mutation `beginAssetUpload` in `hadron-server/src/modules/asset/asset.resolver.ts` + service method `AssetService.mintPresignedPut` in `asset.service.ts`. Validates auth + agent_tools + agent overrides + MIME/size; returns `AssetUploadTicket` with TTL 5 min. Emits `upload-requested` audit log.
- [ ] T021 [P] [US1] Integration test for `beginAssetUpload` in `hadron-server/tests/integration/asset/begin-upload.test.ts`. Cover: success, missing `asset:upload` permission, oversized request, disallowed MIME.
- [ ] T022 [US1] Implement GraphQL mutation `completeAssetUpload` in `hadron-server/src/modules/asset/asset.resolver.ts` + service method `AssetService.completeUpload`. `HeadObject` confirms upload, validates size/MIME match policy, calls `ensureAssetsParent`, persists asset node with `scanStatus: "pending"`, emits `upload-completed` audit log.
- [ ] T023 [P] [US1] Integration test for `completeAssetUpload` in `hadron-server/tests/integration/asset/complete-upload.test.ts` against MinIO. Cover: success, HeadObject 404 (client lied), size mismatch, MIME mismatch.
- [ ] T024 [US1] Implement MCP tool `h-asset-request-upload` in `hadron-server/src/modules/asset/asset.mcp.ts`: validates permission, posts an `asset.requested` event over the chat session's tool-result channel, awaits a `complete | declined | cancelled` signal from the portal, returns the structured result per [contracts/mcp-tools.md](./contracts/mcp-tools.md). Times out after `effectiveTimeoutSeconds` (default 600); emits the matching audit log on every terminal status.
- [ ] T025 [P] [US1] Contract test for `h-asset-request-upload` in `hadron-server/tests/integration/asset/mcp-request-upload.test.ts`. Each terminal status gets a fixture (uploaded, declined, cancelled, timeout, permission-denied).
- [ ] T026 [US1] Build `hadron-portal/src/lib/components/asset/AssetRequestPrompt.svelte`: receives an `asset.requested` event from the active chat stream, renders an in-chat file picker labeled with the agent's prompt, allowed MIME types, and effective max size. Buttons: pick file, "Don't have it" (declined), close (declined). Calls `beginAssetUpload` + R2 PUT + `completeAssetUpload`. Reports terminal status back via the chat-tool-result channel.
- [ ] T027 [P] [US1] Vitest tests for `AssetRequestPrompt.svelte` in `hadron-portal/src/lib/components/asset/AssetRequestPrompt.test.ts`. Cover: render with prompt, pick + upload happy path, decline, cancel mid-upload (AbortController), oversize/MIME rejection at picker.
- [ ] T028 [P] [US1] Build `hadron-portal/src/lib/components/asset/AssetChip.svelte`: renders an asset (filename, MIME icon, size) as a chip in the message thread post-upload.
- [ ] T029 [P] [US1] Vitest tests for `AssetChip.svelte` in `hadron-portal/src/lib/components/asset/AssetChip.test.ts`.
- [ ] T030 [US1] Implement upload helper in `hadron-portal/src/lib/api/upload.ts`: `uploadToR2({ ticket, file, onProgress, signal })` using `fetch` with `Content-Type` and `Content-Length` from the ticket, AbortController-driven cancel, progress events.
- [ ] T031 [P] [US1] Vitest tests for `uploadToR2` in `hadron-portal/src/lib/api/upload.test.ts` against `msw` mock S3 endpoint. Cover: progress, cancel, 4xx propagation.
- [ ] T032 [US1] Wire `AssetRequestPrompt` into `hadron-portal/src/lib/components/AgentChat.svelte` (the existing chat container shipped in PR #174): subscribe to `asset.requested` events from the chat stream and mount the picker.
- [ ] T033 [US1] Playwright e2e in `hadron-portal/tests/e2e/asset-upload-agent-prompted.spec.ts`: full happy path from MCP tool call → portal picker → upload → confirmation. Runs against local MinIO + server + portal.

---

## Phase 4: User Story 2 — Browse + download (Priority: P2)

**Goal**: A user sees their uploaded assets on the agent detail page and can download them.

**Independent test**: After Story 1, navigate to `/agents/<urn>`, see the Assets section listing the upload, click filename, file downloads.

- [ ] T034 [US2] Implement GraphQL query `agentAssets` in `hadron-server/src/modules/asset/asset.resolver.ts` + service method `AssetService.listForCaller`. Filters by uploader (FR-014), MIME, pagination. Excludes soft-deleted. Emits `listed` audit log.
- [ ] T035 [P] [US2] Integration test for `agentAssets` in `hadron-server/tests/integration/asset/list-assets.test.ts`. Cover: pagination, MIME filter, multi-user-agent isolation (uploader A doesn't see uploader B's), soft-deleted exclusion.
- [ ] T036 [US2] Implement GraphQL query `assetDownloadUrl` + service method `AssetService.mintDownloadUrl`. Decrypts `data.storageKey` on request stack, mints presigned GET (TTL 5 min), gates on `scanStatus === "clean"` and uploader scope. Emits `download-url-issued` audit log.
- [ ] T037 [P] [US2] Integration test for `assetDownloadUrl` in `hadron-server/tests/integration/asset/download-url.test.ts`. Cover: clean (success), pending (SCAN_PENDING), blocked (SCAN_BLOCKED), not owner (PERMISSION_DENIED), soft-deleted (NOT_FOUND).
- [ ] T038 [US2] Build `hadron-portal/src/lib/components/asset/AgentAssetsList.svelte`: queries `agentAssets`, renders a paginated list with filename / MIME / size / upload date / source-chat link / scan status badge / download button.
- [ ] T039 [P] [US2] Vitest tests for `AgentAssetsList.svelte` in `hadron-portal/src/lib/components/asset/AgentAssetsList.test.ts`. Cover: rendering, pagination interaction, empty state, scan-status badges.
- [ ] T040 [US2] Mount `AgentAssetsList` on `hadron-portal/src/routes/agents/[urn]/+page.svelte` under a new "Assets" section. Hide section if user has no assets.
- [ ] T041 [US2] Implement download click in `AgentAssetsList`: calls `assetDownloadUrl`, navigates the browser to the returned URL (forces download via `Content-Disposition` from R2 response).
- [ ] T042 [P] [US2] Vitest test for the download click handler in `AgentAssetsList.test.ts` (mock the GraphQL response and assert window-navigation call).
- [ ] T043 [US2] Playwright e2e in `hadron-portal/tests/e2e/asset-browse-download.spec.ts`: after upload from US1's e2e, browse to detail page, click filename, assert downloaded bytes match the uploaded file.

---

## Phase 5: User Story 3 — Agent retrieval in later turns (Priority: P2)

**Goal**: An agent can list its caller's assets and mint download URLs in subsequent chat turns.

**Independent test**: After US1, run `hadron-client invoke h-asset-list` in a fresh session, verify prior asset appears; run `h-asset-get-url --assetId <id>`, verify URL downloads the file.

- [ ] T044 [US3] Implement MCP tool `h-asset-list` in `hadron-server/src/modules/asset/asset.mcp.ts`: thin wrapper around `agentAssets`. Per [contracts/mcp-tools.md](./contracts/mcp-tools.md).
- [ ] T045 [P] [US3] Contract test for `h-asset-list` in `hadron-server/tests/integration/asset/mcp-list.test.ts`. Cover: pagination, mime filter, per-user scoping, permission-denied.
- [ ] T046 [US3] Implement MCP tool `h-asset-get-url`: thin wrapper around `assetDownloadUrl`.
- [ ] T047 [P] [US3] Contract test for `h-asset-get-url` in `hadron-server/tests/integration/asset/mcp-get-url.test.ts`. Cover: clean / pending / blocked / not-owner / not-found.

---

## Phase 6: User Story 4 — Unprompted upload from chat composer (Priority: P3)

**Goal**: User clicks paperclip in chat composer to upload a file, agent sees the asset reference in next turn's context.

**Independent test**: Open a chat with no agent prompt pending, click paperclip, pick file, send next message, verify next agent turn includes the asset URN in its context.

- [ ] T048 [US4] Build `hadron-portal/src/lib/components/asset/AssetUploadButton.svelte`: paperclip icon button + hidden file input. Calls `beginAssetUpload(intent: USER)` → `uploadToR2` → `completeAssetUpload`. Inserts an `AssetChip` into the composer's pending-attachments tray.
- [ ] T049 [P] [US4] Vitest tests for `AssetUploadButton.svelte` in `hadron-portal/src/lib/components/asset/AssetUploadButton.test.ts`.
- [ ] T050 [US4] Wire pending attachments into the next chat-message send: append asset URNs to the message's context payload so the agent sees them.
- [ ] T051 [P] [US4] Vitest test for the message-send wiring in `hadron-portal/src/lib/components/AgentChat.test.ts`.
- [ ] T052 [US4] Playwright e2e in `hadron-portal/tests/e2e/asset-upload-paperclip.spec.ts`.

---

## Phase 7: User Story 5 — Delete + admin recovery (Priority: P3)

**Goal**: User soft-deletes an asset; 24h recovery window; admin can restore; janitor purges after window.

**Independent test**: After US1, delete asset from list — disappears within 1s. Run admin restore mutation — reappears. Advance `purgeAt` past now and run janitor — R2 object deleted, node hard-deleted.

- [ ] T053 [US5] Implement GraphQL mutation `softDeleteAsset` in `asset.resolver.ts`: sets `data.deletedAt = now`, `data.purgeAt = now + 24h`. Caller must be uploader or admin. Emits `soft-deleted` audit log.
- [ ] T054 [P] [US5] Integration test for `softDeleteAsset` in `hadron-server/tests/integration/asset/soft-delete.test.ts`. Cover: by uploader, by org admin, by other user (denied).
- [ ] T055 [US5] Implement GraphQL mutation `restoreAsset` in `asset.resolver.ts`: clears `deletedAt` and `purgeAt` if asset still exists. Admin-only. Emits `restored` audit log.
- [ ] T056 [P] [US5] Integration test for `restoreAsset` in `hadron-server/tests/integration/asset/restore.test.ts`. Cover: admin restore, non-admin denied, already-purged returns null.
- [ ] T057 [US5] Implement janitor in `hadron-server/scripts/janitor-assets.ts`: (a) hard-delete nodes whose `data.purgeAt < now`, deleting the R2 object first; (b) reap orphan R2 keys with no corresponding active node, older than 24h. Idempotent. Emits `purged` audit log per asset.
- [ ] T058 [P] [US5] Integration test for the janitor in `hadron-server/tests/integration/asset/janitor.test.ts`. Cover: purge expired, leave non-expired alone, reap orphan key, idempotent re-run.
- [ ] T059 [P] [US5] Add `yarn server janitor:assets` script entry to `hadron-server/package.json`.
- [ ] T060 [US5] Build delete affordance in `AgentAssetsList.svelte`: trash-icon button per row, confirmation dialog, calls `softDeleteAsset`.
- [ ] T061 [P] [US5] Vitest test for delete affordance in `AgentAssetsList.test.ts`.
- [ ] T062 [US5] Playwright e2e in `hadron-portal/tests/e2e/asset-delete.spec.ts`.

---

## Phase 8: Permissions toggle + per-agent overrides

**Goal**: Builder can toggle `asset:upload` per agent and override default size cap / MIME allowlist.

- [ ] T063 Implement GraphQL mutation `setAgentAssetUploadEnabled` in `asset.resolver.ts`: adds/removes `"asset:upload"` from `App.agent_tools`. Org admin only.
- [ ] T064 [P] Integration test for `setAgentAssetUploadEnabled` in `hadron-server/tests/integration/asset/permission-toggle.test.ts`.
- [ ] T065 Read per-agent overrides from `App.properties.assets` in `AssetService.getEffectiveLimits(appId)` (size cap, MIME allowlist, request timeout). Falls back to platform defaults; clamps to platform ceiling.
- [ ] T066 [P] Unit test for `getEffectiveLimits` in `hadron-server/tests/unit/asset/effective-limits.test.ts`.
- [ ] T067 Build "Tool permissions" + "Asset upload settings" sections in `hadron-portal/src/routes/agents/[urn]/edit/+page.svelte`: toggle for `asset:upload`, optional fields for max size and MIME allowlist.
- [ ] T068 [P] Vitest test for the agent-edit asset settings in `hadron-portal/src/routes/agents/[urn]/edit/+page.test.ts`.

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Documentation, entity ledger, dev-time conveniences, PR descriptions.

- [ ] T069 Add `hadron-docs/docs/reference/asset-upload.md`: builder-facing tool contract page covering `h-asset-*` tools, GraphQL surface, opt-in toggle, defaults, and known limitations (scan-status pending in dev, single-user scoping in multi-user agents). Cross-link to constitution + spec.
- [ ] T070 [P] Add `hadron-docs/mkdocs.yml` nav entry for the new page; verify `mkdocs serve` renders.
- [ ] T071 [P] Update `hadron-concept/hadron-specs/Features/MCP-Tools.md`: add an "Assets" section listing `h-asset-request-upload`, `h-asset-list`, `h-asset-get-url`.
- [ ] T072 [P] Update `hadron-concept/hadron-specs/General/Entities.md`: add a note under the Node entity describing the `asset` nodeType convention (parent at `assets/`, `data` shape pointer to data-model.md, edge labels). Also flip the `TODO(SPEC-LEDGER)` constitution note (or update Entities.md cross-references that point to phantom `spec-kits/specs/...` paths to point at this spec instead).
- [ ] T073 [P] Add `HADRON_ASSET_SCAN_AUTO_CLEAN` env flag to `hadron-server/src/modules/asset/asset.service.ts`: when truthy, new assets land with `scanStatus: "clean"`. Document in `hadron-server/.env.example` as DEV-ONLY.
- [ ] T074 [P] Add a metrics counter for asset operations to existing observability layer (`assets.upload.completed`, `assets.download.url.issued`, etc.) — best-effort; skip if no existing metrics layer.
- [ ] T075 [P] PR descriptions for each repo, referencing this spec + Constitution Check + Complexity Tracking entry: hadron-server, hadron-portal, hadron-docs, hadron-concept.

---

## Dependencies

- **Phase 1 → Phase 2**: T001 (constitution amendment) blocks T002 (Node-Types update) blocks T003 (Prisma comment). T005 (deps install) blocks all server-code tasks.
- **Phase 2 → Phase 3+**: T008–T019 (foundation) block all user-story tasks. Within Phase 2, T010 (validator) blocks T020/T022 (mutations that write asset nodes); T015 (access control) blocks T034/T036; T013 (audit helper) blocks every operation that emits a log; T019 (codegen) blocks all portal GraphQL ops.
- **User stories**:
  - US1 (Phase 3) is the MVP; US2/US3 are independent of each other but both depend on US1's mutations existing (they query the assets US1 produces).
  - US4 (paperclip) reuses `uploadToR2` from US1.
  - US5 (delete) is independent once Phase 2 is complete.
- **Phase 8 (permissions)**: T063 (toggle) is independent. T065 (effective limits) is consumed by T020/T024 — tag it as a follow-up enhancement to those tasks; the initial implementation reads platform defaults only.
- **Phase 9 (polish)**: All independent. Run after all user-story phases complete.

## Parallel execution opportunities

- **Phase 1**: T003, T004, T005, T006, T007 all `[P]` after T001+T002 land.
- **Phase 2**: T009 (r2 client tests), T011/T012 (validator wiring + tests), T013/T014 (audit helper + tests), T015/T016 (access control + tests), T017/T018 (parent helper + tests) all run in parallel after T008+T010 complete.
- **Phase 3 (US1)**: All test tasks (T021, T023, T025, T027, T029, T031) run alongside their implementation tasks. Server work (T020, T022, T024) and portal work (T026, T028, T030, T032) are different files — most parallelizable.
- **Phase 9**: T069–T075 all `[P]`.

## Suggested MVP scope

Ship US1 only first if you want a fast halfway-house: agent-prompted upload that writes to R2 and persists the asset node, no UI for browsing, no agent retrieval, no delete. That's Phases 1–3. US2 then unblocks the user-facing browse + download. US3 (agent retrieval) is highest leverage to ship right after US2. US4/US5 can land in a follow-up if pressed for time.

## Format validation

- All tasks have a checkbox `- [ ]`, a sequential ID `T###`, a `[P]` marker where applicable, a `[USx]` story label in user-story phases only, and an absolute file path.
- 75 tasks total. Per-story counts: Setup 7, Foundational 12, US1 14, US2 10, US3 4, US4 5, US5 10, Permissions 6, Polish 7.
