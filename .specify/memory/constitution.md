<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR amendment — Invariant #2 widens the canonical
NodeType list from five (`abstract`, `info`, `reference`, `record`,
`system`) to six (adds `asset`). Driven by the asset-upload spec
(`specs/001-asset-upload/`); rationale lives in the brainstorm summary
at `hadron-concept/brainstorming/2026-04-28-asset-upload-design/summary.md`.
No principle removals or redefinitions.

Initial ratification (1.0.0, 2026-04-28): Five named principles + 12
technology invariants authored from the project brief, hadron-specs/,
the references brainstorm summary, and the recently shipped
001-edge-condition spec.

Modified in 1.1.0:
- Invariant #2: NodeType list now `abstract`, `asset`, `info`,
  `reference`, `record`, `system` (six values).

Added sections: (none — single-invariant edit)

Removed sections: (none)

Templates requiring updates:
- ✅ .specify/memory/constitution.md (this file — amended)
- ✅ hadron-concept/hadron-specs/Features/Node-Types.md (asset row added)
- ✅ hadron-server/prisma/schema.prisma (nodeType column comment updated)
- ⚠ .specify/templates/plan-template.md — Constitution Check section
  still reads `[Gates determined based on constitution file]`. Acceptable
  for now; the asset-upload plan demonstrated that `/speckit-plan` can
  enumerate gates explicitly. Future amendment may pre-fill the table.
- ⚠ .specify/templates/spec-template.md, tasks-template.md — no edits
  required for this amendment.

Follow-up TODOs:
- TODO(REVIEW): Raghvind to confirm the 12 invariants still reflect the
  team's intent. Invariant #6 is the only one with an explicit anchor in
  hadron-specs/General/Entities.md; the rest are inferred.
- TODO(SPEC-LEDGER): hadron-specs/General/Entities.md references
  `spec-kits/specs/001-edge-condition-spec/` and `003-station-to-app/`
  paths that don't exist on disk. Either (a) seed those spec directories
  from the existing brainstorms and shipped commits, or (b) update
  Entities.md to point at the brainstorming sessions instead. The
  asset-upload spec at `hadron-portal/specs/001-asset-upload/` is the
  first canonical spec; treat it as the template for back-fill.
-->

# Hadron Constitution

## Core Principles

### I. Test-First (NON-NEGOTIABLE)

Every implementation task MUST ship with tests in the same PR. Server changes
require unit and integration tests. Portal changes require component or
serializer tests. The contract is: no test, no merge. The cost of skipping
this is paid at the next migration or refactor — every undocumented behavior
becomes a guess. Tests serve as the executable spec for behavior the code
documentation can't pin down.

**Rules:**

- A pull request that adds or changes runtime behavior MUST include tests
  exercising the new or changed paths.
- A pull request fixing a bug MUST add a regression test that fails before
  the fix and passes after. If a regression test isn't feasible, the PR
  description MUST explain why and what manual verification was done.
- Test files live alongside source (`*.test.ts`, `*.spec.ts`) or under a
  `tests/` directory; the choice follows the surrounding repo convention.
- Constitution Check at `/speckit-plan` time MUST reject plans that don't
  enumerate per-task test pairings.

### II. Docs-Concurrent

User-visible behavior MUST land with documentation in the same feature
branch. The canonical user docs live at `hadron-docs` (MkDocs site,
docs.hadronmemory.com). Internal-architecture docs live at
`hadron-concept/hadron-specs/`. Stale docs are worse than missing docs —
they actively mislead.

**Rules:**

- Every spec MUST have at least one task whose deliverable is a docs page
  in `hadron-docs/` (or an update to an existing one).
- Entity-shape changes MUST update `hadron-concept/hadron-specs/General/Entities.md`
  in the same feature branch.
- Tool-surface changes MUST update `hadron-concept/hadron-specs/Features/MCP-Tools.md`
  and the relevant `hadron-docs` reference page.
- If a feature ships behind a flag, the docs MUST mark it as such; flagged
  features without a docs page are not "shipped."

### III. Accessible to Non-Technical Readers

Specs, briefs, and user-facing docs MUST be readable by a non-engineer
stakeholder. Implementation docs may be technical, but anything used to
align stakeholders or onboard new builders MUST avoid unnecessary jargon
and define terms on first use.

**Rules:**

- `spec.md` (specify-stage output) MUST express user stories in plain
  language. "User MUST be able to upload a document to their agent and
  retrieve it later," not "User invokes `h-asset-request-upload`."
- `summary.md` (brainstorm closure) MUST be readable cold by someone who
  hasn't followed the discussion.
- Hadron-docs pages MUST lead with the concept, then the API, not the
  reverse.
- An exception applies to `plan.md` and `tasks.md`, which are
  engineer-facing by design — but they still MUST link out to the
  user-readable spec.

### IV. Brainstorm → Spec → Implement

Non-trivial work originates as a brainstorming session in
`hadron-concept/brainstorming/`, closes with a `summary.md`, then enters
the spec-kit workflow (`/speckit-specify` → `/speckit-clarify` →
`/speckit-plan` → `/speckit-tasks` → `/speckit-implement`). Skipping the
brainstorm phase for non-trivial work is a constitutional violation that
MUST be justified in the plan's Complexity Tracking section.

**Rules:**

- "Non-trivial" = anything touching more than one repo, anything
  changing entity shape, anything introducing a new external dependency,
  or anything with two or more reasonable design alternatives.
- Each brainstorming session names its open decisions explicitly in the
  seed turn. Closure is `summary.md` recording the choice and the
  rationale, not just the choice.
- Specs MUST link the originating brainstorming `summary.md` from their
  Background section.
- Trivial work (typo fixes, dependency bumps, dead-code removal) MAY
  skip directly to a PR.

### V. Zero-Trust Apps

Apps (the unified caller-identity entity replacing Station — see
Invariant #6) authenticate against the platform via revocable AppKey
credentials. The platform never trusts inbound app traffic without
verifying the credential, the App's permissions, and the target memory's
access layers. Plaintext credentials MUST never be stored or logged.
Server-side decryption is at request time, never cached past the request.

**Rules:**

- All API endpoints (REST, GraphQL, MCP) MUST resolve the caller to an
  App or User context before any data access.
- App credentials MUST be stored as bcrypt hashes; raw values are shown
  once at creation and never reconstructable.
- Encrypted secrets (LLM API keys, OAuth tokens, R2 access keys, asset
  storage references in encrypted memories) MUST use AES-256-GCM under
  `HADRON_ENCRYPTION_KEY` (see Invariant #7).
- Memory access enforcement applies the most-restrictive-wins layering
  in `hadron-specs/Authorization/Memory Access Control.md` at every
  query and mutation boundary.
- New tools that exfiltrate or transmit data externally (email send,
  asset upload, webhook actions) MUST be opt-in per agent and MUST log
  every invocation as an `AppLogEntry`.

## Technology Invariants

These are durable architectural commitments. New plans inherit them by
default. A plan that violates an invariant MUST justify the violation in
its Complexity Tracking section and propose either a one-off carve-out
(rare) or a constitution amendment (preferred for systemic changes).

1. **Memory ↔ Node ↔ Edge data model.** All persistent knowledge lives
   as nodes connected by labeled directed edges, scoped to a memory.
   Net-new persistent entities MUST justify why they don't fit this
   shape. Cross-entity references SHOULD be edges, not stringly-typed
   foreign keys, when both endpoints are nodes.

2. **Six NodeTypes** (`abstract`, `asset`, `info`, `reference`,
   `record`, `system`) — canonical list at
   `hadron-concept/hadron-specs/Features/Node-Types.md`. Adding or
   removing a NodeType is a MINOR constitution amendment and MUST update
   that spec, the Prisma `nodeType` value comment, and any type-aware
   dispatch in the same PR. The Prisma column is a `String` (not enum) by
   design — convention is enforced at the spec + validator level, not by
   the schema. (`asset` was added in v1.1.0 alongside the asset-upload
   spec at `hadron-portal/specs/001-asset-upload/`.)

3. **URN scheme** as the canonical global identifier:
   `<org>:<resource>[:<path>:<segments>]` with `:` as the sole structural
   delimiter. New addressable entities (Memory, Agent, App, Node, future
   asset references) MUST conform. Dots are literal characters within
   segments (e.g. domain names); slashes and spaces are forbidden.

4. **Organization-scoped tenancy.** Every persistent resource is owned
   by an Organization. Each User has a personal Organization
   auto-created on signup (`is_visible: false`). Org URN = the
   organization's domain name. Cross-org access is via
   `MemorySubscription` only.

5. **MCP tool naming convention.** Tools exposed via the Hadron MCP
   server use `h-<verb>-<noun>` (`h-add-node`, `h-find-ref`,
   `h-add-citation`). Platform tools surfaced through the (forthcoming)
   tool registry follow the same shape. Tool names are stable contracts
   — renames require a deprecation cycle.

6. **Caller-identity unification: App over Station.** All new code uses
   the `App` entity for caller identity. `Station` is deprecated and
   removed in Phase 4 of the `003-station-to-app` migration. `AppKey`
   rows hold credentials (one or many per app, independently revocable);
   `App` itself does not hold a primary `key_hash`. App-Agent linkage
   uses `AppAgent` with the `OPERATE` / `DEVELOP` role split.

7. **Encryption at rest under `HADRON_ENCRYPTION_KEY`.** Sensitive
   credentials and tokens (LLM API keys, GitHub tokens, OAuth tokens,
   storage access keys, asset storage references in encrypted memories)
   MUST be encrypted with AES-256-GCM using the symmetric key from the
   server's environment. Plaintext is decrypted at request time only and
   never cached past the request stack. Key rotation is a single
   migration that re-encrypts all stored secrets.

8. **Layered, most-restrictive-wins memory access control.** Reads and
   writes pass through the layer stack defined in
   `hadron-specs/Authorization/Memory Access Control.md`: visibility →
   org membership → cross-org subscription role → agent subscription
   type → station/app role → edge condition. New mutations MUST honor
   all five layers; bypassing any layer is a security defect.

9. **Edge conditions** are JSONLogic expressions evaluated by the shared
   edge-condition evaluator (spec `001-edge-condition-spec`, shipped in
   PR #174). Conditions are validated against the v1 operator subset and
   the five variable scopes (`memory.*`, `chat.*`, `agent.*`,
   `message.data.*`, `now()` / `today()`). New conditional behaviors MUST
   plug into the evaluator, not into bespoke per-feature predicates.

10. **Cloudflare R2 for blob storage.** AWS S3 and Google Cloud Storage
    are excluded for non-technical reasons settled in the
    `2026-04-28-asset-upload-design` brainstorm. New blob-storage
    features use R2 via the S3-compatible API. CDN and edge compute use
    Cloudflare. Departing from this requires either a new brainstorm or
    an amendment.

11. **Multi-repo layout.**
    - `hadron-server` — MCP server + GraphQL API + Prisma data layer.
    - `hadron-portal` — SaaS web UI (SvelteKit + Apollo).
    - `hadron-client` — MCP client / CLI.
    - `hadron-docs` — MkDocs site at docs.hadronmemory.com (canonical
      user docs).
    - `hadron-concept` — specs, brainstorms, implementation plans;
      not deployed.
    Cross-cutting features ship as one feature branch per repo (same
    `NNN-<short-name>` prefix), one PR per repo, all referencing the
    same spec. The `hadron-web-content` repo referenced in older docs
    is deprecated; use `hadron-docs`.

12. **LLM-provider portability.** Agents store provider + model + an
    encrypted API key on the `App` (`ai_provider`, `ai_model`,
    `ai_api_key_encrypted`). Supported providers are pluggable
    (Anthropic, OpenAI, AWS Bedrock as of 2026-04-28). New LLM-using
    code paths MUST go through the existing provider-agnostic chat
    layer rather than instantiating provider SDKs directly. Adding a
    new provider is a MINOR amendment.

## Development Workflow

The default flow for any non-trivial work, end to end:

1. **Brainstorm** — open a `hadron-concept/brainstorming/<YYYY-MM-DD>-<topic>/`
   directory. Seed the discussion (`001-cc.md` or `001-<handle>.md`),
   iterate until decisions have stated rationale, close with `summary.md`.
2. **Specify** — `/speckit-specify` from `hadron-portal` (where
   `.specify/` is installed). Creates `specs/NNN-<short>/spec.md` from
   the template plus the matching feature branch. Fill user stories
   (P1/P2/P3), functional requirements, success criteria, and the
   Entity Impact section if applicable. Link the brainstorm `summary.md`
   from Background.
3. **Clarify** — `/speckit-clarify` if the spec has ambiguities. Resolve
   them in `spec.md` itself, not in plan/tasks.
4. **Plan** — `/speckit-plan` generates `plan.md`. **Constitution Check**
   happens here: every applicable principle and invariant gets one line
   confirming compliance OR a Complexity Tracking entry justifying the
   violation. Plans without a Constitution Check are blocked from
   /speckit-tasks.
5. **Tasks** — `/speckit-tasks` generates `tasks.md`. Every
   implementation task pairs with a test task (Principle I). At least
   one "Update hadron-docs" task per feature (Principle II).
   Entity-ledger update task whenever entities change (Principle II).
6. **Implement** — `/speckit-implement` runs the tasks. One feature
   branch per repo (`NNN-<short>`), one PR per repo on completion.
   Treat the spec as a single feature even when it spans multiple
   repos.

**PR gates (per-repo, all required to merge):**

- All tests pass (Principle I).
- Docs and entity-ledger updates included where applicable (Principle II).
- Constitution Check from `plan.md` is referenced in the PR description.
- For changes touching auth or secrets handling: a one-line note in the
  PR description confirming Invariants #6, #7, and #8 are honored.

**Branch naming:** `NNN-<short-name>` where `NNN` is the spec sequence
number assigned by `.specify/scripts/bash/create-new-feature.sh`. Same
number across all repos for the same feature.

## Governance

This constitution supersedes ad-hoc team practices. PRs and reviews MUST
verify compliance with the principles and invariants listed above.
Complexity that violates any invariant MUST be justified in the plan's
Complexity Tracking section.

**Amendment procedure:**

- Proposed changes go through a brainstorm in
  `hadron-concept/brainstorming/<YYYY-MM-DD>-constitution-amendment-<topic>/`
  with explicit named decisions.
- The brainstorm `summary.md` and the proposed constitution diff land in
  a single PR against `hadron-portal:main`. The PR title MUST start with
  `docs: amend constitution to vX.Y.Z`.
- The author of the amendment MUST run the consistency-propagation
  checklist from the `speckit-constitution` skill: update plan-template,
  spec-template, tasks-template, runtime guidance docs (`README.md`,
  `CLAUDE.md`, `.github/copilot-instructions.md`) to reflect the change.
- Amendments require approval from at least one other repo maintainer
  before merge. Self-merging an amendment is forbidden.

**Versioning policy** (semantic):

- **MAJOR** — backward-incompatible governance/principle removal or
  redefinition.
- **MINOR** — new principle/section added, or materially expanded
  guidance (e.g. a new technology invariant).
- **PATCH** — clarifications, wording fixes, typo fixes, non-semantic
  refinements.

**Compliance review:**

- Every `/speckit-plan` invocation runs an automated Constitution Check
  against this file. Plans that don't enumerate compliance for each
  applicable principle/invariant are rejected.
- Quarterly: a maintainer reviews recent PRs for constitutional drift —
  invariants that are routinely worked around without amendment are
  evidence the invariant needs to be updated, not silently ignored.

**Version**: 1.1.0 | **Ratified**: 2026-04-28 | **Last Amended**: 2026-04-28
