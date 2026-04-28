# Feature Specification: Asset Upload Tool

**Feature Branch**: `001-asset-upload`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User description: "Asset upload tool: agent prompts user for document or image, stores asset in Cloudflare R2 via direct presigned PUT, persists an asset node (nodeType: asset) in the user's per-agent memory, lets user list and download via short-TTL presigned GET."

## Background

This is the first platform tool with **bi-directional data flow**: an agent
asks the user for something, the user supplies it, and the result flows back
into the agent's conversation context. The shape of this feature will inform
the platform-tools registry that's still under design.

Decisions resolved in the brainstorming session:
[`hadron-concept/brainstorming/2026-04-28-asset-upload-design/summary.md`](../../../hadron-concept/brainstorming/2026-04-28-asset-upload-design/summary.md).

Source brief (resolved questions removed):
[`hadron-concept/implementation-plans/2026-04-28-asset-upload-tool.md`](../../../hadron-concept/implementation-plans/2026-04-28-asset-upload-tool.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent asks the user to upload a document, user uploads (Priority: P1)

A user is chatting with a no-code agent. The agent needs a document from the
user (a business plan, a recipe photo, a receipt) to do its job. The agent
asks for it in plain language; the user picks a file from their device; the
file uploads; the agent acknowledges and can reference the file in its next
turn.

**Why this priority**: This is the core round-trip. Without it, agents that
need documents from users can't work. Every other story is additive.

**Independent Test**: Configure an agent with the upload tool enabled. Have
the agent ask for a document. The user picks a small PDF. The file is stored
and the agent's next turn confirms receipt. The user did not have to leave
chat to make this work.

**Acceptance Scenarios**:

1. **Given** an agent with the upload tool enabled and a chat session with a
   user, **When** the agent asks the user for "a copy of your business plan,"
   **Then** the chat surfaces a file picker labeled with the agent's prompt.
2. **Given** the file picker is open, **When** the user selects a PDF under
   the configured size limit, **Then** the file uploads with visible progress
   and a confirmation appears in the message thread referencing the file.
3. **Given** the file picker is open, **When** the user clicks "Don't have
   it" or closes the picker, **Then** the agent receives a "declined" result
   and can continue the conversation accordingly.
4. **Given** an upload is in progress, **When** the user clicks "Cancel,"
   **Then** the upload aborts, no asset is persisted, and the agent receives
   a "cancelled" result.

---

### User Story 2 - User browses and downloads their previously uploaded assets (Priority: P2)

After a user has uploaded files in a chat, they want to see what they've
shared and re-download a copy. They open the agent's page and see an
"Assets" section listing their uploads with filename, type, size, and the
chat that produced them. Clicking one downloads it.

**Why this priority**: Without this, uploads are opaque — users can't audit
what they shared or recover a copy. Required for trust.

**Independent Test**: After Story 1 completes, navigate to the agent's
detail page. The uploaded file appears in the Assets list with correct
metadata. Clicking the filename downloads the original bytes.

**Acceptance Scenarios**:

1. **Given** a user has uploaded one or more assets to an agent, **When**
   they open the agent's detail page in the portal, **Then** an Assets
   section lists each asset with filename, MIME type, size, upload date, and
   a link to the chat that produced it.
2. **Given** the assets list is shown, **When** the user clicks the
   filename, **Then** the original file downloads to their device.
3. **Given** more than 20 assets exist for the agent, **When** the user
   scrolls or paginates the list, **Then** older assets load on demand.

---

### User Story 3 - Agent retrieves a prior asset in a later turn (Priority: P2)

An agent that asked for a document yesterday wants to reference it today.
In a later chat turn, the agent calls a "list assets" or "get asset
download URL" tool, finds the prior upload by description or filename, and
either reads the URL into its context or links to it in the response.

**Why this priority**: Without this, every upload is single-use within one
turn. The "store-and-recall" workflow is what makes assets useful as
durable memory.

**Independent Test**: After Story 1, start a new chat. Have the agent ask
for "the business plan you shared earlier." The agent's tool call returns
a URL or content that resolves to the same file the user uploaded.

**Acceptance Scenarios**:

1. **Given** a user previously uploaded an asset to an agent, **When** the
   agent invokes a list-assets tool in a later turn, **Then** the prior
   asset appears in the result with its description, filename, and an
   identifier the agent can use.
2. **Given** the agent has an asset identifier, **When** it requests a
   download URL, **Then** it receives a short-TTL link valid long enough
   to download the file once.
3. **Given** the requested asset has a `blocked` virus-scan status, **When**
   the agent requests a download URL, **Then** the request is denied with
   a clear reason and no URL is issued.

---

### User Story 4 - User uploads a file unprompted from the chat composer (Priority: P3)

The user wants to share a file with the agent without waiting to be asked.
They click a paperclip icon in the chat composer, pick a file, and it
uploads inline. The agent sees the file in its next turn's context.

**Why this priority**: Symmetric to Story 1 but driven by the user. Useful,
but the agent-initiated path is the more common flow for the v1 use cases
(business plan, recipe photo, receipt).

**Independent Test**: From a fresh chat (no agent prompt), the user clicks
the paperclip, picks a file, the file uploads, and the next agent turn
includes the asset reference in its context.

**Acceptance Scenarios**:

1. **Given** a chat with an agent that has the upload tool enabled, **When**
   the user clicks the paperclip icon and selects a file, **Then** the
   upload proceeds with progress feedback and the file appears in the
   message thread.
2. **Given** an asset was uploaded by the user without an agent prompt,
   **When** the user sends their next message, **Then** the agent's turn
   has the asset reference available in its context.

---

### User Story 5 - User deletes a previously uploaded asset (Priority: P3)

The user wants to remove a file they shared earlier — maybe they shared
the wrong document, or they no longer want it on the platform. They open
the assets list, click delete, and the asset is removed from the agent's
view and the storage.

**Why this priority**: Required for trust ("can I unshare this?") but not
on the critical path for v1 functionality.

**Independent Test**: After Story 1, the user opens the assets list,
clicks delete on the uploaded asset, confirms, and the asset disappears
from the list. Within 24 hours an admin can still recover it; after 24
hours it's irrecoverable.

**Acceptance Scenarios**:

1. **Given** an asset exists in the user's assets list, **When** the user
   clicks delete and confirms, **Then** the asset is removed from the
   list and from the agent's accessible context.
2. **Given** an asset was soft-deleted within the last 24 hours, **When**
   an admin restores it, **Then** the asset reappears in the list and
   downloads work again.
3. **Given** an asset was soft-deleted more than 24 hours ago, **When**
   anyone tries to restore it, **Then** the operation fails because the
   underlying bytes have been purged.

---

### Edge Cases

- **File too large.** User picks a file above the per-agent size cap. The
  picker rejects it with a clear message naming the cap; no upload starts.
- **Disallowed MIME type.** User picks a file whose MIME type is not in
  the agent's allowlist. The picker rejects it before upload starts.
- **Network failure mid-upload.** Upload aborts; partial bytes in storage
  are reaped by a janitor; the user is shown a retry option; no asset
  node is created.
- **User declines the agent's request.** Agent receives a `declined`
  result; conversation continues without an asset.
- **Agent requests upload from a user without the upload tool enabled
  on the agent.** Tool call fails with a clear permissions error; the
  agent's turn surfaces this as a configuration problem, not a user
  problem.
- **Encrypted memory.** Asset reference is encrypted at rest; download URL
  generation decrypts on demand and never caches the decrypted form.
- **Multi-user agent.** Asset is stored in the requesting user's per-user
  memory under that agent, not in the agent's shared system memory.
  Other users of the same agent never see the asset.
- **Virus scan blocks the asset.** Asset's scan status is `blocked`;
  download URL generation refuses; the user can delete the asset but
  cannot retrieve it.
- **User uploads the same file twice.** Each upload creates a distinct
  asset node with its own identifier — no automatic deduplication.
- **Asset listed in chat history but later deleted.** The chat reference
  remains for record-keeping, but the asset's presigned URL endpoint
  returns "not found" rather than serving stale content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An agent MUST be able to request a file upload from the
  current user during a chat turn, supplying a prompt explaining what is
  needed.
- **FR-002**: A user MUST be able to fulfill an agent's upload request by
  selecting a file, decline by closing the picker, or cancel an
  in-progress upload.
- **FR-003**: A user MUST be able to upload a file unprompted via a chat
  composer affordance (paperclip icon).
- **FR-004**: The system MUST persist each successful upload as an
  addressable asset, recording filename, MIME type, size, upload time,
  and the user who uploaded it.
- **FR-005**: A user MUST be able to view a list of their assets scoped
  to a given agent, sorted by upload time, with pagination for lists
  longer than the page size.
- **FR-006**: A user MUST be able to download the original file for any
  asset they uploaded.
- **FR-007**: An agent MUST be able to query its accessible assets and
  retrieve a download link for any individual asset during a chat turn.
- **FR-008**: A user MUST be able to delete an asset they uploaded, with
  a 24-hour recovery window during which an admin (not the user) can
  restore it.
- **FR-009**: The upload capability MUST be off by default for a new
  agent and require explicit opt-in by the agent's builder before any
  agent-initiated upload requests are accepted.
- **FR-010**: The system MUST enforce a maximum file size and an
  allowlist of MIME types per upload, configurable per agent, with
  reasonable defaults applied when no agent-level override is set.
- **FR-011**: The system MUST encrypt asset storage references at rest
  in encrypted memories, decrypting only at request time to mint a
  download link.
- **FR-012**: The system MUST log every upload, list, download, and
  delete operation in the agent's audit trail.
- **FR-013**: The system MUST gate downloads behind an asset-level
  scan-status flag; assets that are not yet scanned or have been blocked
  cannot be downloaded.
- **FR-014**: Asset visibility MUST be scoped to the uploading user;
  other users of the same agent (in multi-user agents) MUST NOT see or
  download another user's assets.
- **FR-015**: An agent-initiated upload request MUST time out after a
  bounded interval if the user neither uploads nor declines, and the
  agent MUST receive a `timeout` result instead of hanging.
- **FR-016**: Download links MUST expire shortly after issuance so a
  leaked link cannot be reused indefinitely.

### Key Entities *(include if feature involves data)*

- **Asset**: A file uploaded by a user to a specific agent's memory.
  Carries filename, MIME type, size, upload timestamp, the uploading
  user, an optional description, and a scan-status flag. Stored as a
  node in the memory graph (the storage shape is settled in the
  brainstorm summary; the spec leaves implementation to the plan).
- **Assets root**: The parent node under which all of a user's assets
  for a given agent live. Provisioned lazily on first upload, mirroring
  the existing per-user memory provisioning pattern.
- **Asset reference (cross-node)**: A directed edge from another node
  (e.g., a recipe in the agent's memory) to an asset node, expressing
  "this node has an attached asset." Edge labels (`has-image`,
  `attaches`, etc.) describe the relationship.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete an agent-prompted upload (request →
  pick → upload → confirmation) in under 60 seconds for files up to 10
  MB on a typical residential broadband connection.
- **SC-002**: An agent can reference an uploaded asset in the next chat
  turn without the user reloading or restarting the conversation.
- **SC-003**: A user can find and download a previously uploaded asset
  in three or fewer clicks starting from the agent chat page.
- **SC-004**: At least 95% of uploads attempted by users complete
  successfully on the first try (excluding user-initiated cancellations).
- **SC-005**: Asset download links become invalid within 5 minutes of
  issuance; an attacker who exfiltrates a link cannot reuse it after
  that window.
- **SC-006**: 0% of agents without the upload tool explicitly enabled
  can issue upload requests; permission failures are surfaced as
  configuration errors, not user errors.
- **SC-007**: 0% of users in a multi-user agent can list, download, or
  reference another user's uploaded assets.
- **SC-008**: After a user soft-deletes an asset, the asset is invisible
  in their list within one second; recovery within 24 hours restores it
  to its prior state.

## Assumptions

- **Default file size cap**: 25 MB per upload. Per-agent override
  permitted up to a platform ceiling set during the plan phase.
- **Default MIME-type allowlist**: common document and image types
  (PDF, PNG, JPEG, WebP, plain text, common Office formats). Per-agent
  override permitted.
- **Asset retention**: indefinite; user-initiated soft-delete with a
  24-hour recovery window before underlying bytes are purged.
- **Agent-initiated upload request timeout**: 10 minutes. The agent
  receives a `timeout` result if the user takes no action.
- **Single-step replace**: a user replacing an existing asset overwrites
  the prior asset's bytes and creates one node-history entry; full
  versioning is out of scope.
- **No cross-user or cross-agent sharing of assets in v1.** Sharing is
  a follow-up brainstorm.
- **No content extraction (PDF text, image OCR) in v1.** Asset bodies
  are opaque blobs; description is user- or agent-supplied. A separate
  spec addresses extraction.
- **No customer-managed encryption keys for asset bytes in v1.**
  Provider-managed encryption at rest is sufficient for v1 use cases
  (business plans, recipe photos, receipts). Customer-managed keys are
  a follow-up spec for HIPAA/CMK customers.
- **Virus-scan implementation is out of scope.** The download gate that
  honors a scan-status flag is in scope; the actual scanner is a
  follow-up.
- **The platform-tools registry shape is unsettled.** Tool naming for
  this feature is provisional; the implementation will conform to
  whatever shape the registry settles on, with renames handled as
  deprecations rather than breaking changes.
