# Implementation Plan: Asset Upload Tool

**Branch**: `001-asset-upload` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-asset-upload/spec.md`

## Summary

Ship the first bi-directional platform tool: an agent prompts the user for a
file, the user uploads directly to Cloudflare R2 via a presigned PUT URL,
the server persists an `asset` node in the user's per-agent memory, and the
agent can list/download those assets in subsequent turns. Adds a sixth
NodeType (`asset`), wires opt-in-per-agent permissions, encrypts the storage
reference at rest in encrypted memories, and lays a virus-scan gate without
shipping the scanner. Spans hadron-server, hadron-portal, and hadron-docs.

## Technical Context

**Language/Version**: TypeScript ≥5.4 (server, portal, client). Node.js
20 LTS for runtime.
**Primary Dependencies**: Apollo Server + Prisma + PostgreSQL (server);
SvelteKit + Apollo client (portal); MkDocs Material (docs);
`@aws-sdk/client-s3` (R2 access via S3-compatible API).
**Storage**: PostgreSQL for entities (per Prisma schema); Cloudflare R2
for blob storage (one bucket per environment, key shape
`{orgUrn}/{memoryUrn-segment}/{assetId}.{ext}`).
**Testing**: Jest (server unit + integration); Vitest +
Svelte Testing Library (portal); Playwright (portal e2e for upload
flow); shell-driven contract tests for MCP tools.
**Target Platform**: Linux server (Fly.io / containerized), modern
browsers (Chromium, Firefox, Safari) for portal, MCP clients (Claude
Code / IDE extensions) for tool surface.
**Project Type**: Multi-repo web service (server + web frontend +
docs), with cross-repo coordination via single feature branch
`001-asset-upload` and one PR per repo.
**Performance Goals**: SC-001 through SC-008 from spec. Notable:
upload round-trip ≤60s for 10 MB files (SC-001); presigned URL TTL
5 min (SC-005); upload-tool-disabled enforcement 100% (SC-006).
**Constraints**: Default file size cap 25 MB; per-agent override up to
platform ceiling 100 MB; default MIME allowlist (PDF/PNG/JPEG/WebP/
text/common Office); 24h soft-delete recovery window; 10-min
agent-initiated request timeout.
**Scale/Scope**: Thousands of users per agent; hundreds of MB to a few
GB of assets per agent typical; single-bucket-per-env scales to ≥10 M
objects with R2's prefix-based key model.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version checked against: **1.0.0** (ratified 2026-04-28).
File: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

### Principles

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Test-First (NON-NEGOTIABLE) | ✅ PASS | Every implementation task in `tasks.md` will pair with a test task — server unit/integration, portal component/e2e, MCP contract tests. |
| II | Docs-Concurrent | ✅ PASS | Tasks include: `hadron-docs` reference page (`reference/asset-upload.md`); `hadron-specs/Features/MCP-Tools.md` updated; `hadron-specs/General/Entities.md` updated for the new asset node convention; `hadron-specs/Features/Node-Types.md` updated to add `asset`. |
| III | Accessible to Non-Technical Readers | ✅ PASS | `spec.md` validated against the Specification Quality Checklist; user stories and FR/SC items use plain language, no `h-*` tool names in user-facing requirements. |
| IV | Brainstorm → Spec → Implement | ✅ PASS | This plan derives from `spec.md`, which links to brainstorm `summary.md`. Brainstorm closed with explicit rationale on both decisions. |
| V | Zero-Trust Apps | ✅ PASS | All tool calls authenticate via App context; presigned URLs minted server-side after permission check; `data.storageKey` encrypted at rest in encrypted memories; every upload/list/download/delete logged as `AppLogEntry`; opt-in per agent. |

### Technology Invariants

| # | Invariant | Status | Notes |
|---|-----------|--------|-------|
| 1 | Memory ↔ Node ↔ Edge | ✅ PASS | Asset is a node (`assets:<id>`); cross-references to other nodes are edges with descriptive labels (`has-image`, `attaches`). |
| 2 | Five NodeTypes (canonical list) | ⚠ REQUIRES AMENDMENT | This plan adds `asset` as a sixth NodeType. The amendment procedure is followed: tasks include (a) MINOR constitution amendment to v1.1.0 listing `asset`, (b) `hadron-specs/Features/Node-Types.md` update, (c) Prisma `nodeType` line-comment update. See Complexity Tracking entry. |
| 3 | URN scheme | ✅ PASS | Asset URN: `<memory-urn>:assets:<assetId>`. Colon-delimited; no slashes/spaces; conforms. |
| 4 | Organization-scoped tenancy | ✅ PASS | Assets live in a Memory which is owned by an Organization; bucket key prefix scopes by `{orgUrn}`. |
| 5 | MCP tool naming `h-<verb>-<noun>` | ✅ PASS | `h-asset-request-upload`, `h-asset-list`, `h-asset-get-url`. Final names track the platform-tools registry brainstorm. |
| 6 | App over Station | ✅ PASS | All tool callers authenticated as `App` via `AppKey`; tool gating reads from `App.agent_tools`; logging via `AppLogEntry`. No new `Station` references. |
| 7 | AES-256-GCM encryption at rest | ✅ PASS | `data.storageKey` encrypted with `HADRON_ENCRYPTION_KEY` in encrypted memories using the existing per-node encryption helper. R2 access keys remain in env vars. |
| 8 | Layered, most-restrictive-wins access | ✅ PASS | Asset list/download honor visibility → org membership → subscription role → agent subscription type → app role; per-user scoping (FR-014) is added as a 6th gate at the asset-resolution layer. |
| 9 | Edge conditions via shared evaluator | ✅ N/A | This feature does not introduce new conditional behavior. Existing edges (`has-image` etc.) are unconditional. |
| 10 | Cloudflare R2 for blob storage | ✅ PASS | Storage backend is R2 via `@aws-sdk/client-s3` against R2's S3-compatible endpoint. |
| 11 | Multi-repo layout | ✅ PASS | One feature branch (`001-asset-upload`) per repo: hadron-server, hadron-portal, hadron-docs. Hadron-concept gets a same-PR update to entity ledger and Node-Types spec. |
| 12 | LLM-provider portability | ✅ N/A | This feature does not introduce LLM-using code paths. Existing chat layer continues to handle provider selection. |

**Result**: Plan PASSES Constitution Check, with one entry in Complexity
Tracking for Invariant #2 (the amendment procedure is the right answer,
not a violation).

## Project Structure

### Documentation (this feature)

```text
specs/001-asset-upload/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── mcp-tools.md         # h-asset-request-upload / h-asset-list / h-asset-get-url
│   ├── graphql.md           # GraphQL mutations + queries
│   └── http-endpoints.md    # presigned-URL minting + upload-complete callback
├── checklists/
│   └── requirements.md      # Created in /speckit-specify (passing)
└── tasks.md             # /speckit-tasks output (next phase)
```

### Source Code (across repos)

```text
hadron-server/                          # MCP server + GraphQL API + Prisma
├── prisma/schema.prisma                # nodeType comment updated to include "asset"
├── src/
│   ├── modules/asset/
│   │   ├── asset.service.ts            # mintPresignedPut, completeUpload, list, getUrl, softDelete
│   │   ├── asset.resolver.ts           # GraphQL surface
│   │   ├── asset.mcp.ts                # h-asset-* MCP tool handlers
│   │   ├── asset.validator.ts          # save-time validator on nodeType=asset data shape
│   │   └── r2.client.ts                # @aws-sdk/client-s3 wrapper for R2
│   └── ... (existing modules)
└── tests/
    ├── unit/asset/                     # service + validator unit tests
    └── integration/asset/              # e2e against test PG + mocked R2

hadron-portal/                          # SvelteKit + Apollo client
├── src/
│   ├── lib/components/AssetUploadButton.svelte    # paperclip in chat composer
│   ├── lib/components/AssetRequestPrompt.svelte   # agent-initiated picker
│   ├── lib/components/AssetChip.svelte            # in-thread asset chip
│   ├── lib/components/AgentAssetsList.svelte      # agent detail page section
│   ├── lib/api/asset.ts                # GraphQL operations + R2 PUT helper
│   └── routes/agents/[urn]/+page.svelte           # already exists; adds Assets section
└── tests/
    ├── unit/components/asset/          # Vitest + Svelte Testing Library
    └── e2e/asset-upload.spec.ts        # Playwright flow

hadron-docs/                            # MkDocs site
└── docs/
    └── reference/
        └── asset-upload.md             # builder-facing tool contract

hadron-concept/                         # specs + brainstorms (no code)
└── hadron-specs/
    ├── Features/
    │   ├── MCP-Tools.md                # adds Assets section with h-asset-*
    │   └── Node-Types.md               # adds asset row
    └── General/
        └── Entities.md                 # adds Asset node convention note

hadron-portal/.specify/memory/
└── constitution.md                     # amended 1.0.0 → 1.1.0 (adds asset to Invariant #2)
```

**Structure Decision**: Multi-repo web service. The spec spans server,
portal, and docs because the asset upload tool requires backend storage,
frontend file picker UX, and builder documentation in lockstep. One feature
branch per repo, sharing the `001-asset-upload` name.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution amendment 1.0.0 → 1.1.0 (add `asset` to Invariant #2's NodeType list) is bundled in this feature PR rather than originating in a separate `*-constitution-amendment-*` brainstorm | The asset-upload brainstorm at `2026-04-28-asset-upload-design/summary.md` already concluded with the explicit decision and rationale to add `asset` as a first-class NodeType (Decision 2, Option A). Re-running a constitution-amendment-specific brainstorm would duplicate that exact reasoning. The constitution itself was ratified the same day (2026-04-28) — this is the first feature to exercise the amendment process, and the brainstorm summary substantively meets the amendment-procedure requirement (named decision + stated rationale + linked from this plan). | Splitting the amendment into its own brainstorm + PR would delay the asset-upload work by one cycle without surfacing new information. The simpler alternative (add `asset` as a string convention without amending the constitution) was explicitly rejected in the brainstorm because it overloads existing NodeTypes and creates convention drift (see brainstorm 005-rs.md). |

---

## Next-Phase Outputs

Phase 0 produces [`research.md`](./research.md) — consolidates the
brainstorm decisions, R2 access patterns, presigned-URL semantics,
encryption flow, and per-user-memory provisioning approach.

Phase 1 produces:
- [`data-model.md`](./data-model.md) — asset node shape, edges, validator,
  storage-key derivation, encryption boundaries.
- [`contracts/mcp-tools.md`](./contracts/mcp-tools.md) — `h-asset-*`
  surfaces with request/response schemas.
- [`contracts/graphql.md`](./contracts/graphql.md) — GraphQL types,
  mutations, queries.
- [`contracts/http-endpoints.md`](./contracts/http-endpoints.md) —
  REST endpoints for presigned-URL minting and upload-complete callback
  (required for direct browser-to-R2 PUT flow).
- [`quickstart.md`](./quickstart.md) — local dev walkthrough: configure
  R2 creds, opt agent into upload tool, exercise upload + list + download
  flows end-to-end.

Constitution Check is **re-evaluated** at the end of Phase 1 in this same
plan.md (see "Re-evaluation" section at the bottom after research and
contracts are written).

## Re-evaluation (post-Phase 1)

Phase 1 outputs reviewed against the Constitution:

- **Principles I–V**: still ✅ PASS. Tasks paired with tests
  (research.md R-014); docs and entity-ledger updates included
  (plan tasks list); spec remains plain-language; brainstorm linked
  through; presigned URLs server-minted, encryption preserved,
  audit-log surface defined (data-model.md E-005, contracts/mcp-tools.md).
- **Invariants**: no new violations surfaced. Invariant #9 (edge
  conditions) confirmed not applicable — edges introduced
  (`has-image`, `has-attachment`, `attaches`, `derived-from`,
  `referenced-in`) carry no `condition`; they're plain labeled edges.
  Invariant #11 (multi-repo) reaffirmed by data-model.md E-007 and
  contracts/ — three PRs, one per repo, plus a hadron-concept entity-
  ledger PR.
- **Complexity Tracking**: unchanged. The single entry (Invariant #2
  amendment bundled with this feature) stands; no new entries.

**Result**: Plan still PASSES post-Phase 1. Ready for `/speckit-tasks`.
