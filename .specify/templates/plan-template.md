# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Cite `.specify/memory/constitution.md`. For each applicable principle and
invariant below, write one line stating how this plan honors it (or mark N/A
with a short reason). Violations require an entry in Complexity Tracking.

### Principles

- **I. Pragmatic Test-First** — [how tests are covered; link to Test Plan]
- **II. Docs-Concurrent** — [which hadron-docs page(s) update; link to Docs Plan]
- **III. Accessible to Non-Technical Readers** — [if user-facing: jargon, i18n, error msgs; else N/A]
- **IV. Brainstorm → Spec → Implement** — [link brainstorming session, or note exemption]
- **V. Zero-Trust Apps** — [if touching access/membership: server-side enforcement; else N/A]

### Technology Invariants

- **1. Node schema** — [if adding/changing node types or `.node/` layout]
- **2. Four nodeTypes** — [if touching nodeType; amendment to add a fifth]
- **3. Edge ownership** — [if creating/querying edges]
- **4. UUIDv7 IDs** — [if creating time-sorted IDs]
- **5. Client transport (MCP + GraphQL)** — [if exposing client-facing surface]
- **6. App identity** — [if touching App/AppAgent; no `Station*` reintroduction]
- **7. Memory storage model** — [if touching memory storage or integrations]
- **8. Prompt-injection boundary** — [if interpolating user-sourced data into LLM prompts]
- **9. Language/runtime** — [no stack changes without amendment]
- **10. Memory portability** — [if touching export/import or mutable node fields]
- **11. GraphQL API stability** — [if exposing GraphQL externally]
- **12. Sequence ownership** — [if introducing sequenced nodes]

### Verdict

- [ ] All applicable items honored, or violations justified in Complexity Tracking.

## Test Plan *(per Principle I)*

Every implementation task MUST have corresponding test tasks in `tasks.md`.

### Unit tests (deterministic code)
- [Key deterministic modules/functions and their tests; ≥80% line coverage on new code.]

### Evaluation tests (LLM-driven code)
- [LLM-powered components; fixture set and scoring approach. No coverage floor, but each LLM behavior MUST have an eval.]

### Integration tests (contract boundaries)
- [MCP tools, GraphQL mutations touching the graph, cross-service flows. Each boundary crossed by this feature MUST have an integration test.]

## Repos & PRs

List every repo this spec touches. `/speckit-finalize` reads this section
to verify all named PRs are merged and the spec corpus on `main` matches
shipped code (Constitution Principle VI).

| Repo | Branch (planned) | Notes |
|---|---|---|
| [e.g., `hadron-server`] | [e.g., `feat/NNN-feature-name`] | [server-side scope summary] |
| [e.g., `hadron-portal`] | [e.g., `feat/NNN-feature-name`] | [UI scope summary, or "copy-only"] |
| [e.g., `hadron-concept`] | [e.g., `NNN-feature-name`] | [Entities.md updates] |
| [e.g., `hadron-docs`]    | [e.g., `docs/NNN-feature-name`] | [reference page regen + hand-written explanation pages, or N/A] |

If multiple PRs are expected per repo (e.g., a hotfix on top of the main
implementation), list them as separate rows.

## Docs Plan *(per Principle II)*

List the hadron-docs updates required for this feature. These become tasks
in `tasks.md` and MUST merge before the feature ships to production.

- [ ] `hadron-docs/<path>/<page>.md` — [what changes: new concept, updated API, new example, corrected error message, etc.]

If this feature has no user-visible behavior change (pure refactor, internal service change), state why docs are exempt.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
