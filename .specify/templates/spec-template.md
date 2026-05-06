---
# Per Constitution "Implementation Scope": specs target repositories, not
# product brands or domains. List the repos this spec targets. Mandatory.
target-repositories:
  - [e.g., hadron-server]
  - [e.g., hadron-portal]
---

# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`  
**Created**: [DATE]  
**Status**: Draft  
**Input**: User description: "$ARGUMENTS"

## Background *(optional — include when spec has a brainstorming origin)*

<!--
  Per Constitution Principle IV (Brainstorm → Spec → Implement), non-trivial
  features originate as a dated brainstorming session. When this spec has one,
  link it and distill the key context.

  Trivial/exempt changes (typo/wording, dependency bumps, routine hotfixes,
  <30-line single-file changes) should omit this entire section.
-->

**Brainstorming session**: `hadron-concept/brainstorming/YYYY-MM-DD-topic/summary.md`

[1–3 paragraphs distilling the key decisions from the brainstorming that
this spec inherits. Not a rewrite of summary.md — just the essentials needed
to understand why this spec exists and what design choices are already fixed.
Open questions belong in Assumptions or flagged inline with NEEDS CLARIFICATION.]

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]  
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Entity Impact *(include if feature touches the data model)*

<!--
  hadron-concept/hadron-specs/General/Entities.md is the canonical entity
  ledger for the platform. Any feature that adds, removes, or modifies
  entities (or their fields) MUST update Entities.md in the same release.
  tasks.md MUST include a corresponding "Update Entities.md" task — the
  ledger ships with the schema change, not after.

  Describe entities here at a conceptual level (purpose, key fields,
  relationships). Concrete schema (Prisma, SQL, indexes) belongs in
  plan.md / data-model.md, not here.

  Features that don't touch the data model omit this section.
-->

**Added**:

- **[Entity name]** — [purpose; key fields and relationships at a conceptual level]

**Removed**:

- **[Entity name]** — [migration path: replaced by / merged into / deprecated; what happens to existing rows]

**Modified**:

- **[Entity name]** — [field added/removed/renamed/retyped + rationale]

**Ledger update**: `hadron-concept/hadron-specs/General/Entities.md` (tracked in tasks.md)

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- [Assumption about target users, e.g., "Users have stable internet connectivity"]
- [Assumption about scope boundaries, e.g., "Mobile support is out of scope for v1"]
- [Assumption about data/environment, e.g., "Existing authentication system will be reused"]
- [Dependency on existing system/service, e.g., "Requires access to the existing user profile API"]
