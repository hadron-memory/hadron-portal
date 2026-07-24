// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export const MEMORY_FIELDS = /* GraphQL */ `
  fragment MemoryFields on Memory {
    id
    organizationId
    urn
    name
    shortDescription
    description
    tags
    license
    category0
    category1
    category2
    iconUrl
    heroUrl
    homeUrl
    source
    readBranch
    writeBranch
    visibility
    class
    isEncrypted
    # 033-rag-vector-retrieval: per-memory vector-index config.
    vectorIndexEnabled
    embeddingSource
    chunkTokens
    chunkOverlap
    forceFixedSize
    vectorIndexEncryptedAckAt
    # #588 (server #725): opt-in per-memory property schema — declared
    # collections + typed fields. NULL = unstructured.
    schema
    userId
    userMemoryOfAgentId
    anonymousExpiresAt
    agent { id urn name }
    syncStatus
    syncError
    pendingEdgeCount
    lastSyncedAt
    organization { id name }
    createdAt
    updatedAt
  }
`;

export const ORG_FIELDS = /* GraphQL */ `
  fragment OrgFields on Organization {
    id
    name
    urn
    githubInstallationId
    githubAppId
    hasGithubAppPrivateKey
    createdAt
    updatedAt
  }
`;

export const AGENT_FIELDS = /* GraphQL */ `
  fragment AgentFields on Agent {
    id
    organizationId
    urn
    name
    description
    systemPrompt
    systemMemoryId
    visibility
    type
    surfaces
    properties
    # 036-ai-service-config: hasAiApiKey is the server shim for "the agent's
    # 'default' config has a key" — kept for the Chat-tab readiness gate (any
    # member can read it; the registry list itself is org-ADMIN gated).
    hasAiApiKey
    memoryItems {
      id
      role
      memory { id urn name organizationId visibility }
    }
    # 008-agent-installation: declarative knobs + installation count.
    memoryProvisioning { appMemory }
    installationPolicy { maxMembers memberRoles }
    imports {
      parentAgentId
      importedAgentId
      importedAgent { id urn name }
      position
      required
      createdAt
    }
    appCount
    createdAt
  }
`;

export const APP_FIELDS = /* GraphQL */ `
  fragment AppFields on App {
    id
    name
    urn
    organizationId
    appType
    role
    description
    systemPrompt
    agentTools
    expiresAt
    # App-original fields
    createUserPermission
    identifyUserMethod
    sessionTimeoutSeconds
    anonymousTtlDays
    # 008-agent-installation: direct FK + new App-level fields.
    agentId
    agent {
      id
      urn
      name
      description
      systemPrompt
      surfaces
      memoryItems {
        id
        role
        memory { id urn name }
      }
      installationPolicy { maxMembers memberRoles }
    }
    surfaces
    memberCount
    trainingMode
    keys {
      id
      keyPreview
      label
      createdAt
      lastUsedAt
      revokedAt
    }
    createdAt
    updatedAt
  }
`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const ME_QUERY = /* GraphQL */ `
  query Me {
    me {
      id
      handle
      githubUsername
      name
      avatarUrl
      email
      roles
    }
  }
`;

// Public profile read for /app/user/[id] (#533). `ref` accepts a PK or a
// `hrn:user:<handle>` URN (hadron-server#473 uniform read). The server gates
// resolution to the user themselves, a platform admin, or a co-member and
// returns null otherwise — denied and missing are indistinguishable — so this
// selects only the public identifiers (no PII name/email; those stay gated by
// the User field resolvers even when included).
export const USER_PROFILE_QUERY = /* GraphQL */ `
  query UserProfile($ref: ID!) {
    user(ref: $ref) {
      id
      handle
      urn
      githubUsername
      avatarUrl
    }
  }
`;

export const INVITE_USER_MUTATION = /* GraphQL */ `
  mutation InviteUser($name: String, $email: String, $githubUsername: String, $maxActivations: Int, $expiresInDays: Int) {
    inviteUser(name: $name, email: $email, githubUsername: $githubUsername, maxActivations: $maxActivations, expiresInDays: $expiresInDays) {
      id slug name email githubUsername maxActivations expiresAt createdAt
    }
  }
`;

export const UPDATE_MY_PROFILE_MUTATION = /* GraphQL */ `
  mutation UpdateMyProfile($name: String, $handle: String, $email: String) {
    updateMyProfile(name: $name, handle: $handle, email: $email) {
      id handle name email
    }
  }
`;

export const JOIN_WAITING_LIST_MUTATION = /* GraphQL */ `
  mutation JoinWaitingList($email: String!, $requestedFeatures: String) {
    joinWaitingList(email: $email, requestedFeatures: $requestedFeatures)
  }
`;

export const SEND_CONTACT_MESSAGE_MUTATION = /* GraphQL */ `
  mutation SendContactMessage($name: String!, $email: String!, $message: String!) {
    sendContactMessage(name: $name, email: $email, message: $message)
  }
`;

// hadron-server#473: uniform read surface — find-one queries take \`ref\`
// (PK or URN) instead of \`id\`. Variable names stay \`$id\` so call sites
// keep passing \`{ id: ... }\`.
export const MEMORY_BY_ID_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query MemoryById($id: ID!) {
    memory(ref: $id) {
      ...MemoryFields
      subscriptions {
        id
        role
        organization { id name urn }
      }
    }
  }
`;

// hadron-server#473: orgSystemMemories(orgId:) is now the uniform
// memories(orgId:, filter: { memoryClasses: [system] }) list. NOTE: the new
// query is membership-gated with NO platform-admin bypass — an admin who is
// not a member of the org gets an empty page instead of the org's system
// memories.
export const ORG_SYSTEM_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query OrgSystemMemories($orgId: ID!, $limit: Int, $offset: Int) {
    memories(orgId: $orgId, filter: { memoryClasses: [system] }, limit: $limit, offset: $offset) {
      items {
        ...MemoryFields
      }
      total
    }
  }
`;

// hadron-server#473: publicMemories is now the uniform memories() list with
// the PUBLIC marketplace slice selected via filter.visibility.
export const PUBLIC_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query PublicMemories($limit: Int, $offset: Int) {
    memories(filter: { visibility: PUBLIC }, limit: $limit, offset: $offset) {
      items {
        ...MemoryFields
      }
      total
    }
  }
`;

export const ADD_TO_MY_MEMORIES_MUTATION = /* GraphQL */ `
  mutation AddToMyMemories($memoryId: ID!) {
    addToMyMemories(memoryId: $memoryId)
  }
`;

// cor:acl:080:04 — the marketplace catalogue: listedOnMarketplace + publicly
// accessible orgs / agents / memories, as sanitized flat refs. One request
// fetches the first page of each section (browse landing).
export const MARKETPLACE_QUERY = /* GraphQL */ `
  query Marketplace($limit: Int, $offset: Int) {
    marketplaceOrganizations(limit: $limit, offset: $offset) {
      items { id name urn description }
      total
    }
    marketplaceAgents(limit: $limit, offset: $offset) {
      items { id name urn description }
      total
    }
    marketplaceMemories(limit: $limit, offset: $offset) {
      items { id name urn description }
      total
    }
  }
`;

// hadron-server#473: myOrganizations is now the uniform organizations() list
// (the caller's memberships). NOTE: a platform ADMIN/OWNER now receives EVERY
// live org, not just their memberships — the admin unscoped reach. That is
// the right list for BROWSE surfaces (/app/orgs, cross-org agent lookups);
// nav / active-org RESOLUTION must use ORGANIZATIONS_NAV_QUERY below instead.
export const ORGANIZATIONS_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  ${AGENT_FIELDS}
  ${APP_FIELDS}
  query Organizations($limit: Int, $offset: Int) {
    organizations(limit: $limit, offset: $offset) {
      items {
        ...OrgFields
        members {
          id
          role
          user { id handle githubUsername name avatarUrl email }
        }
        memories {
          ...MemoryFields
        }
        agents {
          ...AgentFields
        }
        apps {
          ...AppFields
        }
      }
      total
    }
  }
`;

// #486 / hadron-server#551 — the cross-org marketplace slice: every live
// PUBLIC agent, no membership required (deliberately separate from the
// member-scoped agents() list, server #552). Slim selection — the picker
// only renders identity + provenance.
export const PUBLIC_AGENTS_QUERY = /* GraphQL */ `
  query PublicAgents($limit: Int, $offset: Int) {
    publicAgents(limit: $limit, offset: $offset) {
      items { id urn name description organizationId visibility }
      total
    }
  }
`;

// Find-one agent read for the install flow's PUBLIC path (#486): since
// server #552, agent(ref:) admits a PUBLIC agent for ANY caller (non-public
// keeps the membership gate). Callers must still check visibility === PUBLIC
// before treating a cross-org hit as installable.
export const AGENT_PUBLIC_QUERY = /* GraphQL */ `
  query AgentPublic($id: ID!) {
    agent(ref: $id) {
      id
      urn
      name
      description
      organizationId
      visibility
    }
  }
`;

// #486 — the org's Agent subscriptions (AgentOrgGrant rows: the 008 Org↔Agent
// license, auto-provisioned on first install). Kept OUT of ORGANIZATION_QUERY:
// the field resolver is org-ADMIN gated (non-admins get []), and widening the
// shared org payload has cross-route blast radius (review:shared-layout-
// payload-consumers). AgentOrgGrant.agent lazily resolves server-side.
export const ORG_AGENT_GRANTS_QUERY = /* GraphQL */ `
  query OrgAgentGrants($id: ID!) {
    organization(ref: $id) {
      id
      agentOrgGrants {
        agentId
        activatedAt
        expiresAt
        revokedAt
        isActive
        createdAt
        agent { id urn name description organizationId }
      }
    }
  }
`;

// Explicit marketplace subscribe step (#649): creates the org-level Agent
// license without also installing an App. Both refs accept IDs or URNs.
export const CREATE_AGENT_ORG_GRANT_MUTATION = /* GraphQL */ `
  mutation CreateAgentOrgGrant($agentRef: ID!, $orgRef: ID!) {
    createAgentOrgGrant(agentRef: $agentRef, orgRef: $orgRef) {
      agentId
    }
  }
`;

// Revoke the org-level Agent license without deleting its App/install state.
// Both refs accept IDs or URNs; the server preserves the grant lifecycle row.
export const REVOKE_AGENT_ORG_GRANT_MUTATION = /* GraphQL */ `
  mutation RevokeAgentOrgGrant($agentRef: ID!, $orgRef: ID!) {
    revokeAgentOrgGrant(agentRef: $agentRef, orgRef: $orgRef) {
      agentId
    }
  }
`;

// Slim membership-scoped org list for the nav / active-org resolution path
// (layout sidebar + OrgSwitcher/CommandBar, auth-callback landing, the
// marketplace post-add redirect). filter.memberOnly restricts the list to the
// caller's own memberships SERVER-side, even for a platform ADMIN/OWNER (the
// old myOrganizations semantics — hadron-server cor:api:120:03), so an
// admin's nav doesn't receive every live org. Selection is only what
// resolution + nav actually read: OrgFields scalars (id/name for
// resolveActiveOrg, urn for display) plus a
// members[].user.id skeleton for the filterToMemberOrgs defense-in-depth
// (the count of which also drives consumer-mode detection) —
// none of the heavy memories/agents/apps/member-PII nesting the browse query
// carries (flagged by Copilot on portal PR #451).
export const ORGANIZATIONS_NAV_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  query OrganizationsNav($limit: Int, $offset: Int) {
    organizations(filter: { memberOnly: true }, limit: $limit, offset: $offset) {
      items {
        ...OrgFields
        members {
          id
          role
          user { id }
        }
      }
      total
    }
  }
`;

export const EXCHANGE_CONNECTION_FIELDS = /* GraphQL */ `
  fragment ExchangeConnectionFields on ExchangeConnection {
    id
    organizationId
    userId
    mailboxEmail
    displayName
    syncEnabled
    syncStatus
    lastSyncAt
    lastError
    createdAt
    updatedAt
  }
`;

export const ORGANIZATION_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  ${AGENT_FIELDS}
  ${EXCHANGE_CONNECTION_FIELDS}
  query Organization($id: ID!) {
    organization(ref: $id) {
      ...OrgFields
      members {
        id
        role
        canInvite
        createdAt
        user { id handle githubUsername name avatarUrl email }
      }
      memories {
        ...MemoryFields
        subscriptions {
          id
          role
          organization { id name urn }
        }
      }
      agents {
        ...AgentFields
      }
      subscriptions {
        id
        role
        activated
        memory { ...MemoryFields organization { id name urn } }
        organization { id name urn }
      }
      exchangeConnections {
        ...ExchangeConnectionFields
      }
    }
  }
`;

// hadron-server#473: MY_APPS_QUERY (myApps) was removed — it had no callers
// and the server folded myApps + apps(orgId!) into the uniform apps() list
// (see APPS_QUERY below).

export const APP_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query App($id: ID!) {
    app(ref: $id) {
      ...AppFields
      # Spec 021 US1: canonical R2 install URN combining App + Agent
      # identities. Scoped to this query (rather than baked into
      # AppFields) so other consumers of the shared fragment — the
      # list views, mutations, etc. — don't hard-depend on the new
      # server-side field. That keeps the portal deployable against
      # a server that hasn't picked up spec-021-US1 yet without
      # breaking unrelated app queries.
      installedAgentUrn
    }
  }
`;

// 008-agent-installation: members carried separately so the bulk
// myApps/app queries don't have to drag membership rows along.
export const APP_WITH_MEMBERS_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query AppWithMembers($id: ID!) {
    app(ref: $id) {
      ...AppFields
      members {
        appId
        userId
        role
        createdAt
        updatedAt
        user { id handle githubUsername name avatarUrl email }
      }
    }
  }
`;

export const ENSURE_APP_MEMBER_MUTATION = /* GraphQL */ `
  mutation EnsureAppMember($appId: ID!, $userId: ID!, $role: String!) {
    ensureAppMember(appId: $appId, userId: $userId, role: $role) {
      appId
      userId
      role
      createdAt
      updatedAt
      user { id handle githubUsername name avatarUrl email }
    }
  }
`;

export const REMOVE_APP_MEMBER_MUTATION = /* GraphQL */ `
  mutation RemoveAppMember($appId: ID!, $userId: ID!) {
    removeAppMember(appId: $appId, userId: $userId)
  }
`;

// hadron-server#473: the admin users list and searchUsers are both the
// uniform users() list now. Admin may omit filter.query for the full list;
// a non-admin caller with no query gets an empty page.
export const USERS_QUERY = /* GraphQL */ `
  query Users($limit: Int, $offset: Int) {
    users(limit: $limit, offset: $offset) {
      items { id handle githubUsername name avatarUrl email roles maxReferrals }
      total
    }
  }
`;

export const SEARCH_USERS_QUERY = /* GraphQL */ `
  query SearchUsers($query: String!, $limit: Int) {
    users(filter: { query: $query }, limit: $limit) {
      items { id handle urn githubUsername name avatarUrl email }
      total
    }
  }
`;

export const GLOBAL_SEARCH_QUERY = /* GraphQL */ `
  query GlobalSearch($query: String!, $entityTypes: [SearchEntityType!], $fields: [SearchField!], $limit: Int) {
    globalSearch(query: $query, entityTypes: $entityTypes, fields: $fields, limit: $limit) {
      hits {
        entityType
        id
        urn
        name
        description
        matchedField
        score
        memoryId
        organizationId
      }
      degraded
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CREATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation CreateOrganization($name: String!, $urn: String!) {
    createOrganization(name: $name, urn: $urn) { ...OrgFields }
  }
`;

export const UPDATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation UpdateOrganization($id: ID!, $name: String, $urn: String) {
    updateOrganization(id: $id, name: $name, urn: $urn) { ...OrgFields }
  }
`;

export const DELETE_ORGANIZATION_MUTATION = /* GraphQL */ `
  mutation DeleteOrganization($id: ID!) {
    deleteOrganization(id: $id)
  }
`;

export const ADD_MEMBER_MUTATION = /* GraphQL */ `
  mutation AddOrgMember($orgId: ID!, $userId: ID!, $role: Role!) {
    addOrgMember(orgId: $orgId, userId: $userId, role: $role) {
      id role canInvite createdAt
      user { id handle githubUsername name avatarUrl email }
    }
  }
`;

export const UPDATE_MEMBER_MUTATION = /* GraphQL */ `
  mutation UpdateOrgMember($orgId: ID!, $userId: ID!, $role: Role!) {
    updateOrgMember(orgId: $orgId, userId: $userId, role: $role) {
      id role
      user { id handle githubUsername name avatarUrl email }
    }
  }
`;

export const REMOVE_MEMBER_MUTATION = /* GraphQL */ `
  mutation RemoveOrgMember($orgId: ID!, $userId: ID!) {
    removeOrgMember(orgId: $orgId, userId: $userId)
  }
`;

// ---------------------------------------------------------------------------
// User Invitations
// ---------------------------------------------------------------------------

export const CREATE_USER_INVITATION_MUTATION = /* GraphQL */ `
  mutation CreateUserInvitation(
    $orgId: ID!, $memberRole: Role!, $name: String, $email: String,
    $githubUsername: String, $maxActivations: Int, $expiresInDays: Int
  ) {
    createUserInvitation(
      orgId: $orgId, memberRole: $memberRole, name: $name, email: $email,
      githubUsername: $githubUsername, maxActivations: $maxActivations, expiresInDays: $expiresInDays
    ) {
      id slug memberRole name email githubUsername maxActivations expiresAt createdAt
      organization { id name urn }
    }
  }
`;

export const INVITATION_QUERY = /* GraphQL */ `
  query Invitation($slug: String!) {
    invitation(slug: $slug) {
      id slug memberRole name email githubUsername
      maxActivations activationCount expiresAt createdAt
      sender { id name githubUsername }
      organization { id name urn }
    }
  }
`;

export const ACCEPT_INVITATION_MUTATION = /* GraphQL */ `
  mutation AcceptInvitation($slug: String!) {
    acceptInvitation(slug: $slug)
  }
`;

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export const CREATE_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation CreateMemory(
    $orgId: ID!, $name: String!, $shortDescription: String, $description: String,
    $tags: [String!], $license: String,
    $category0: String, $category1: String, $category2: String,
    $iconUrl: String, $heroUrl: String, $homeUrl: String,
    $source: String, $readBranch: String, $writeBranch: String,
    $visibility: MemoryVisibility, $memoryClass: MemoryClass = knowledge
  ) {
    createMemory(
      orgId: $orgId, name: $name, shortDescription: $shortDescription, description: $description,
      tags: $tags, license: $license,
      category0: $category0, category1: $category1, category2: $category2,
      iconUrl: $iconUrl, heroUrl: $heroUrl, homeUrl: $homeUrl,
      source: $source, readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility, memoryClass: $memoryClass
    ) { ...MemoryFields }
  }
`;

// #627: create a USER-OWNED (org-less) memory. Omitting `orgId` roots the memory
// on the caller's handle namespace (organizationId NULL, ownerUserId = caller)
// per spec 047; the org-less path supports only the owner-only classes
// `personal` / `private` (visibility is auto-derived server-side, so it's not
// sent). Backs the /app/memories/new individual-user create flow.
export const CREATE_PERSONAL_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation CreatePersonalMemory(
    $name: String!, $description: String, $tags: [String!],
    $memoryClass: MemoryClass = personal
  ) {
    createMemory(name: $name, description: $description, tags: $tags, memoryClass: $memoryClass) {
      ...MemoryFields
    }
  }
`;

export const UPDATE_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation UpdateMemory(
    $id: ID!, $name: String, $urn: String, $organizationId: ID, $shortDescription: String, $description: String,
    $tags: [String!], $license: String,
    $category0: String, $category1: String, $category2: String,
    $iconUrl: String, $heroUrl: String, $homeUrl: String,
    $source: String, $readBranch: String, $writeBranch: String, $visibility: MemoryVisibility,
    $vectorIndexEnabled: Boolean, $embeddingSource: EmbeddingSource,
    $acknowledgeVectorInversionRisk: Boolean,
    $chunkTokens: Int, $chunkOverlap: Int, $forceFixedSize: Boolean,
    $schema: JSON
  ) {
    updateMemory(
      id: $id, name: $name, urn: $urn, organizationId: $organizationId, shortDescription: $shortDescription, description: $description,
      tags: $tags, license: $license,
      category0: $category0, category1: $category1, category2: $category2,
      iconUrl: $iconUrl, heroUrl: $heroUrl, homeUrl: $homeUrl,
      source: $source, readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility,
      vectorIndexEnabled: $vectorIndexEnabled, embeddingSource: $embeddingSource,
      acknowledgeVectorInversionRisk: $acknowledgeVectorInversionRisk,
      chunkTokens: $chunkTokens, chunkOverlap: $chunkOverlap, forceFixedSize: $forceFixedSize,
      schema: $schema
    ) { ...MemoryFields }
  }
`;

export const DELETE_MEMORY_MUTATION = /* GraphQL */ `
  mutation DeleteMemory($id: ID!) { deleteMemory(id: $id) }
`;

// #520: clone a memory's whole graph into a new memory at targetUrn
// (`<org>::<slug>`). Server rejects system/encrypted sources and an occupied
// or malformed targetUrn (BAD_USER_INPUT). Returns the new memory.
export const CLONE_MEMORY_MUTATION = /* GraphQL */ `
  mutation CloneMemory($ref: ID!, $targetUrn: String!) {
    cloneMemory(ref: $ref, targetUrn: $targetUrn) { id urn name }
  }
`;

// #529: revision history for a node (NodeRevision snapshots, #623 rename from
// NodeVersion), most recent first. Access-gated on the node's memory server-side
// (unreadable → empty list). `content` is omitted — the History tab lists
// metadata and snapshot bodies can be large.
export const NODE_REVISIONS_QUERY = /* GraphQL */ `
  query NodeRevisions($nodeRef: ID!, $limit: Int) {
    nodeRevisions(nodeRef: $nodeRef, limit: $limit) {
      id
      loc
      name
      alias
      description
      tags
      # #620 display contract: editedByUser (resolved handle + URN) is preferred;
      # else editedByInfo (identity string); revLabel is the edit reason/label.
      editedBy
      editedByInfo
      editedByUser { handle urn }
      revLabel
      # #620: which node fields the edit changed (empty on legacy rows).
      changes
      createdAt
    }
  }
`;

// #529: a single revision's full snapshot (incl. content) for the read-only
// "Display" view. Access-gated server-side; null when unreadable/missing.
export const NODE_REVISION_QUERY = /* GraphQL */ `
  query NodeRevision($revisionId: ID!) {
    nodeRevision(revisionId: $revisionId) {
      id
      nodeId
      loc
      name
      alias
      description
      content
      tags
      editedBy
      editedByInfo
      editedByUser { handle urn }
      revLabel
      changes
      createdAt
    }
  }
`;

// #529/#617: revision-history write surface (#623 rename). restore(truncate:true)
// restores the node to the revision AND deletes newer snapshots (atomic); delete
// removes one snapshot; clear removes all for a node (returns the count).
export const RESTORE_NODE_REVISION_MUTATION = /* GraphQL */ `
  mutation RestoreNodeRevision($revisionId: ID!, $truncate: Boolean) {
    restoreNodeRevision(revisionId: $revisionId, truncate: $truncate) { id }
  }
`;

export const DELETE_NODE_REVISION_MUTATION = /* GraphQL */ `
  mutation DeleteNodeRevision($revisionId: ID!) { deleteNodeRevision(revisionId: $revisionId) }
`;

export const CLEAR_NODE_HISTORY_MUTATION = /* GraphQL */ `
  mutation ClearNodeHistory($nodeRef: ID!) { clearNodeHistory(nodeRef: $nodeRef) }
`;

export const SYNC_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation SyncMemory($id: ID!) {
    syncMemory(id: $id) { ...MemoryFields }
  }
`;

export const PUSH_MEMORY_TO_GIT_MUTATION = /* GraphQL */ `
  mutation PushMemoryToGit($id: ID!) {
    pushMemoryToGit(id: $id)
  }
`;

export const SET_MEMORY_SOURCE_TOKEN_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation SetMemorySourceToken($id: ID!, $token: String!, $expiresAt: String) {
    setMemorySourceToken(id: $id, token: $token, expiresAt: $expiresAt) { ...MemoryFields }
  }
`;

export const CREATE_MEMORY_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateMemorySubscription($memoryId: ID!, $orgId: ID!, $role: Role!) {
    createMemorySubscription(memoryId: $memoryId, orgId: $orgId, role: $role) {
      id role createdAt
      memory { id name }
      organization { id name urn }
    }
  }
`;

export const DELETE_MEMORY_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation DeleteMemorySubscription($memoryId: ID!, $orgId: ID!) {
    deleteMemorySubscription(memoryId: $memoryId, orgId: $orgId)
  }
`;

// ---------------------------------------------------------------------------
// Agent mutations
// ---------------------------------------------------------------------------

export const CREATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation CreateAgent($orgId: ID!, $name: String!, $description: String, $systemPrompt: String, $systemMemoryId: String, $visibility: AgentVisibility) {
    createAgent(orgId: $orgId, name: $name, description: $description, systemPrompt: $systemPrompt, systemMemoryId: $systemMemoryId, visibility: $visibility) { ...AgentFields }
  }
`;

// #636: org-less agent create — omits orgId, so hadron-server mints a user-owned
// agent (Agent.organizationId NULL, ownerUserId=caller; createAgent's orgId is
// optional). Mirrors CREATE_PERSONAL_MEMORY_MUTATION for the individual path.
export const CREATE_PERSONAL_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation CreatePersonalAgent($name: String!, $description: String, $visibility: AgentVisibility) {
    createAgent(name: $name, description: $description, visibility: $visibility) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgent($id: ID!, $name: String, $urn: String, $description: String, $systemPrompt: String, $systemMemoryId: String, $visibility: AgentVisibility) {
    updateAgent(id: $id, name: $name, urn: $urn, description: $description, systemPrompt: $systemPrompt, systemMemoryId: $systemMemoryId, visibility: $visibility) { ...AgentFields }
  }
`;

export const DELETE_AGENT_MUTATION = /* GraphQL */ `
  mutation DeleteAgent($id: ID!) { deleteAgent(id: $id) }
`;

export const ADD_MEMORY_TO_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation AddMemoryToAgent($agentId: ID!, $memoryId: ID!, $role: String) {
    addMemoryToAgent(agentId: $agentId, memoryId: $memoryId, role: $role) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MEMORY_ROLE_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgentMemoryRole($agentId: ID!, $memoryId: ID!, $role: String!) {
    updateAgentMemoryRole(agentId: $agentId, memoryId: $memoryId, role: $role) { ...AgentFields }
  }
`;

export const REMOVE_MEMORY_FROM_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation RemoveMemoryFromAgent($agentId: ID!, $memoryId: ID!) {
    removeMemoryFromAgent(agentId: $agentId, memoryId: $memoryId) { ...AgentFields }
  }
`;

// ---------------------------------------------------------------------------
// App mutations (App is the unified caller-identity entity per
// Constitution Invariant #6).
// ---------------------------------------------------------------------------

// 009-install-agent-flow: createApp now installs an Agent into an org —
// agentId is required, the install form omits AI config fields (set later
// via UPDATE_APP_MUTATION on the App manage page). The install action
// passes `surfaces` derived from appType (CHATBOT → ['chat'], else
// ['mcp']) so the App manage page surfaces the right tabs — without it,
// the schema default ['chat'] would hide the Client tab on WORKSTATION
// installs and Micromentor's coding-agent CLI flow can't reach the
// download-setup-zip UI.
export const CREATE_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation CreateApp(
    $orgId: ID!, $agentId: ID!, $name: String!, $urn: String,
    $appType: AppType, $role: AppMembershipRole,
    $description: String,
    $surfaces: [String!],
    $createUserPermission: CreateUserPermission,
    $identifyUserMethod: IdentifyUserMethod,
    $sessionTimeoutSeconds: Int, $anonymousTtlDays: Int
  ) {
    createApp(
      orgId: $orgId, agentId: $agentId, name: $name, urn: $urn,
      appType: $appType, role: $role,
      description: $description,
      surfaces: $surfaces,
      createUserPermission: $createUserPermission,
      identifyUserMethod: $identifyUserMethod,
      sessionTimeoutSeconds: $sessionTimeoutSeconds,
      anonymousTtlDays: $anonymousTtlDays
    ) {
      ...AppFields
    }
  }
`;

export const UPDATE_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation UpdateApp(
    $id: ID!, $name: String, $urn: String, $appType: AppType,
    $role: AppMembershipRole,
    $description: String, $systemPrompt: String, $agentTools: [String!],
    $aiProvider: String, $aiModel: String, $aiApiKey: String,
    $expiresAt: String,
    $createUserPermission: CreateUserPermission,
    $identifyUserMethod: IdentifyUserMethod,
    $sessionTimeoutSeconds: Int, $anonymousTtlDays: Int
  ) {
    updateApp(
      id: $id, name: $name, urn: $urn, appType: $appType, role: $role,
      description: $description, systemPrompt: $systemPrompt,
      agentTools: $agentTools,
      aiProvider: $aiProvider, aiModel: $aiModel, aiApiKey: $aiApiKey,
      expiresAt: $expiresAt,
      createUserPermission: $createUserPermission,
      identifyUserMethod: $identifyUserMethod,
      sessionTimeoutSeconds: $sessionTimeoutSeconds,
      anonymousTtlDays: $anonymousTtlDays
    ) {
      ...AppFields
    }
  }
`;

export const REGENERATE_APP_KEY_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation RegenerateAppKey($id: ID!) {
    regenerateAppKey(id: $id) { rawKey app { ...AppFields } }
  }
`;

// ---------------------------------------------------------------------------
// App Keys
// ---------------------------------------------------------------------------

// hadron-server#598: read-surface args renamed <entity>Id → <entity>Ref
// (ref accepts a PK or URN). Variable names + call-site keys follow suit.
export const APP_KEYS_QUERY = /* GraphQL */ `
  query AppKeys($appRef: ID!) {
    appKeys(appRef: $appRef) {
      id label keyPreview lastUsedAt createdAt revokedAt
    }
  }
`;

export const CREATE_APP_KEY_MUTATION = /* GraphQL */ `
  mutation CreateAppKey($appId: ID!, $label: String) {
    createAppKey(appId: $appId, label: $label) {
      key { id label keyPreview createdAt }
      rawKey
    }
  }
`;

export const REVOKE_APP_KEY_MUTATION = /* GraphQL */ `
  mutation RevokeAppKey($id: ID!) {
    revokeAppKey(id: $id)
  }
`;

export const DELETE_APP_MUTATION = /* GraphQL */ `
  mutation DeleteApp($id: ID!) { deleteApp(id: $id) }
`;

// 008-agent-installation: addAgentToApp is now a setter on App.agent_id —
// the legacy `role` arg is gone (system memory is universally read-only
// from any App context per R-10).
export const ADD_AGENT_TO_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation AddAgentToApp($appId: ID!, $agentId: ID!, $trainingMode: Boolean) {
    addAgentToApp(appId: $appId, agentId: $agentId, trainingMode: $trainingMode) {
      ...AppFields
    }
  }
`;

// 008-agent-installation: removeAgentFromApp clears App.agent_id.
export const REMOVE_AGENT_FROM_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation RemoveAgentFromApp($appId: ID!, $agentId: ID!) {
    removeAgentFromApp(appId: $appId, agentId: $agentId) {
      ...AppFields
    }
  }
`;

// ---------------------------------------------------------------------------
// AI Service Config registry (spec 036). Named configs owned by exactly one of
// HadronServer / Organization / App / Agent, resolved by name walking
// App → Agent → Org → HadronServer. The masked list never returns key
// material; resolveAIConfig is privileged and returns the decrypted key
// (used only server-side for the runtime/test paths).
// ---------------------------------------------------------------------------

export const AI_SERVICE_CONFIG_FIELDS = /* GraphQL */ `
  fragment AiServiceConfigFields on AiServiceConfig {
    id
    name
    ownerType
    ownerId
    provider
    model
    hasApiKey
    apiKeyPreview
    params
    enabled
    createdAt
    updatedAt
  }
`;

// hadron-server#473: owner args moved into filter; result is the uniform
// { items, total } page.
export const AI_SERVICE_CONFIGS_QUERY = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  query AiServiceConfigs($ownerType: AiConfigOwnerType!, $ownerId: ID!, $limit: Int, $offset: Int) {
    aiServiceConfigs(filter: { ownerType: $ownerType, ownerId: $ownerId }, limit: $limit, offset: $offset) {
      items {
        ...AiServiceConfigFields
      }
      total
    }
  }
`;

export const CREATE_AI_SERVICE_CONFIG_MUTATION = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  mutation CreateAiServiceConfig(
    $ownerType: AiConfigOwnerType!, $ownerId: ID!, $name: String!,
    $provider: String!, $model: String!, $apiKey: String, $params: JSON, $enabled: Boolean
  ) {
    createAiServiceConfig(
      ownerType: $ownerType, ownerId: $ownerId, name: $name,
      provider: $provider, model: $model, apiKey: $apiKey, params: $params, enabled: $enabled
    ) {
      ...AiServiceConfigFields
    }
  }
`;

export const UPDATE_AI_SERVICE_CONFIG_MUTATION = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  mutation UpdateAiServiceConfig(
    $id: ID!, $name: String, $provider: String, $model: String,
    $apiKey: String, $params: JSON, $enabled: Boolean
  ) {
    updateAiServiceConfig(
      id: $id, name: $name, provider: $provider, model: $model,
      apiKey: $apiKey, params: $params, enabled: $enabled
    ) {
      ...AiServiceConfigFields
    }
  }
`;

export const DELETE_AI_SERVICE_CONFIG_MUTATION = /* GraphQL */ `
  mutation DeleteAiServiceConfig($id: ID!) {
    deleteAiServiceConfig(id: $id)
  }
`;

// Privileged — returns the DECRYPTED key. Server gates on org-ADMIN / platform.
// Used only server-side (runtime chat path + Test); never sent to the browser.
export const RESOLVE_AI_CONFIG_QUERY = /* GraphQL */ `
  query ResolveAIConfig($name: String, $appRef: ID, $agentRef: ID) {
    resolveAIConfig(name: $name, appRef: $appRef, agentRef: $agentRef) {
      provider
      model
      apiKey
      params
    }
  }
`;

// Masked, resolution-aware set of configs selectable in a chat context
// (App -> Agent -> Org -> Host, deduped by name, enabled-only, no key
// material). Auth: App membership (or platform admin). Powers the App chat
// tab's config picker + LLM-readiness gate.
export const RESOLVE_AI_SERVICE_CONFIGS_QUERY = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  query ResolveAiServiceConfigs($appRef: ID, $agentRef: ID) {
    resolveAiServiceConfigs(appRef: $appRef, agentRef: $agentRef) {
      ...AiServiceConfigFields
    }
  }
`;

export const MY_CHATS_QUERY = /* GraphQL */ `
  query MyChats($agentRef: ID!, $limit: Int, $offset: Int) {
    myChats(agentRef: $agentRef, limit: $limit, offset: $offset) {
      id
      loc
      title
      conversationName
      stageName
      messageCount
      createdAt
      lastMessageAt
      scope
      createdBy
    }
  }
`;

export const CHAT_HISTORY_QUERY = /* GraphQL */ `
  query ChatHistory($chatId: String!, $limit: Int) {
    chatHistory(chatId: $chatId, limit: $limit) {
      role
      content
      seq
      createdAt
    }
  }
`;

export const START_CHAT_MUTATION = /* GraphQL */ `
  mutation StartChat(
    $agentId: ID!
    $conversationName: String
    $scope: ChatScope
    $isTestRun: Boolean
  ) {
    startChat(
      agentId: $agentId
      conversationName: $conversationName
      scope: $scope
      isTestRun: $isTestRun
    ) {
      chatId
      systemMessage
      tools
      conversationName
      stageName
    }
  }
`;

export const SEND_CHAT_MESSAGE_MUTATION = /* GraphQL */ `
  mutation SendChatMessage($chatId: String!, $userMessage: String!) {
    sendChatMessage(chatId: $chatId, userMessage: $userMessage) {
      systemMessage
      tools
      messageHistory
      summarizationNeeded {
        messageCount
        prompt
      }
    }
  }
`;

export const PROCESS_CHAT_RESPONSE_MUTATION = /* GraphQL */ `
  mutation ProcessChatResponse($chatId: String!, $toolResponse: JSON!) {
    processChatResponse(chatId: $chatId, toolResponse: $toolResponse) {
      displayMessage
      stageTransitioned
      newStageName
      conversationHandoff
      chatEnded
      onTrack
      offTrackReason
    }
  }
`;

export const SAVE_CHAT_SUMMARY_MUTATION = /* GraphQL */ `
  mutation SaveChatSummary($chatId: String!, $summary: String!) {
    saveChatSummary(chatId: $chatId, summary: $summary)
  }
`;

export const UPDATE_CHAT_TITLE_MUTATION = /* GraphQL */ `
  mutation UpdateChatTitle($chatId: String!, $title: String!) {
    updateChatTitle(chatId: $chatId, title: $title)
  }
`;

export const DELETE_CHAT_MUTATION = /* GraphQL */ `
  mutation DeleteChat($chatId: String!) {
    deleteChat(chatId: $chatId)
  }
`;

// ---------------------------------------------------------------------------
// Edge CRUD
// ---------------------------------------------------------------------------

export const CREATE_EDGE_MUTATION = /* GraphQL */ `
  mutation CreateEdge(
    $sourceNodeId: ID!
    $targetNodeId: ID!
    $name: String
    $condition: JSON
    $priority: Int
    $data: JSON
  ) {
    createEdge(
      sourceRef: $sourceNodeId
      targetRef: $targetNodeId
      name: $name
      condition: $condition
      priority: $priority
      data: $data
    ) {
      id name loc isRunnable condition priority data source { id loc name } target { id loc name }
    }
  }
`;

export const UPDATE_EDGE_MUTATION = /* GraphQL */ `
  mutation UpdateEdge(
    $edgeId: ID!
    $name: String
    $description: String
    $isRunnable: Boolean
    $condition: JSON
    $priority: Int
    $data: JSON
  ) {
    updateEdge(
      edgeRef: $edgeId
      name: $name
      description: $description
      isRunnable: $isRunnable
      condition: $condition
      priority: $priority
      data: $data
    ) {
      id name loc isRunnable description condition priority data source { id loc name } target { id loc name }
    }
  }
`;

// Loads the edge's HOST (source) node by id with the full edge field set —
// condition / priority / data / description aren't in the lean NODE_FIELDS
// fragment (they'd bloat every graph/browse payload). The edge detail page
// (#350) loads its source node and picks the edge out of outgoingEdges, since
// the server has no single-edge query (resolveUrn doesn't dispatch edges).
//
// We DON'T select `source` on the outgoing edges: the host node IS the source
// (the page renders it from `host`), so it would only bloat the payload.
// (Since server PR #381 Edge.source/target lazily load when not preloaded,
// so selecting it is no longer a 500 — just redundant here.)
export const EDGE_HOST_NODE_QUERY = /* GraphQL */ `
  query EdgeHostNode($id: ID!) {
    node(ref: $id) {
      id
      memoryId
      loc
      name
      data
      memory { id urn name }
      outgoingEdges {
        id
        name
        loc
        description
        isRunnable
        condition
        priority
        data
        target { id loc name description tags memory { id urn } }
      }
      # Flow context (#478): nodes routing INTO this one contribute their
      # extractionSpec fields to the run envelope, so the condition builder
      # offers them. One level here (the node read preloads incomingEdges'
      # source); deeper levels are fetched separately — Node.incomingEdges
      # has no lazy resolver, so nesting it under source would come back
      # empty.
      incomingEdges {
        name
        loc
        source { id loc name data }
      }
    }
  }
`;

// Level-2 upstream fetch for the flow field picker (#478): the incoming
// flow edges of ONE upstream node, with each edge's source node data.
// Best-effort — the edge editor works without it.
export const FLOW_UPSTREAM_NODE_QUERY = /* GraphQL */ `
  query FlowUpstreamNode($id: ID!) {
    node(ref: $id) {
      id
      incomingEdges {
        name
        loc
        source { id loc name data }
      }
    }
  }
`;

export const DELETE_EDGE_MUTATION = /* GraphQL */ `
  mutation DeleteEdge($edgeId: ID!) {
    deleteEdge(edgeRef: $edgeId)
  }
`;

// ---------------------------------------------------------------------------
// Revisions + editor lock
// ---------------------------------------------------------------------------

export const CREATE_REVISION_MUTATION = /* GraphQL */ `
  mutation CreateRevision($agentId: ID!, $description: String) {
    createRevision(agentId: $agentId, description: $description) {
      revisionLoc label published createdAt
    }
  }
`;

export const PUBLISH_REVISION_MUTATION = /* GraphQL */ `
  mutation PublishRevision($agentId: ID!, $revisionLoc: String!, $versionLabel: String) {
    publishRevision(agentId: $agentId, revisionLoc: $revisionLoc, versionLabel: $versionLabel) {
      revisionLoc label published createdAt
    }
  }
`;

export const RESTORE_REVISION_MUTATION = /* GraphQL */ `
  mutation RestoreRevision($agentId: ID!, $revisionLoc: String!) {
    restoreRevision(agentId: $agentId, revisionLoc: $revisionLoc) {
      revisionLoc label published createdAt
    }
  }
`;

export const ACQUIRE_EDITOR_LOCK_MUTATION = /* GraphQL */ `
  mutation AcquireEditorLock($agentId: ID!) {
    acquireEditorLock(agentId: $agentId) {
      locked lockedBy expiresAt
    }
  }
`;

export const RELEASE_EDITOR_LOCK_MUTATION = /* GraphQL */ `
  mutation ReleaseEditorLock($agentId: ID!) {
    releaseEditorLock(agentId: $agentId)
  }
`;

export const APP_NODES_QUERY = /* GraphQL */ `
  query AppNodes($appRef: ID!, $limit: Int) {
    appNodes(appRef: $appRef, limit: $limit) {
      id
      memoryId
      nodeType
      loc
      name
      description
      tags
      seq
      isRunnable
      memory { id urn name organizationId }
      outgoingEdges {
        id
        name
        loc
        isRunnable
        target { id loc name }
      }
      incomingEdges {
        id
        name
        loc
        isRunnable
        source { id loc name }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSIONS_QUERY = /* GraphQL */ `
  query Sessions($limit: Int, $offset: Int) {
    sessions(limit: $limit, offset: $offset) {
      id
      type
      appId
      repo
      branch
      llmModel
      summary
      inputTokens
      outputTokens
      turnCount
      errorCount
      startedAt
      endedAt
    }
  }
`;

export const USAGE_EVENTS_QUERY = /* GraphQL */ `
  query UsageEvents($type: String, $memoryId: ID, $limit: Int, $offset: Int) {
    usageEvents(type: $type, memoryId: $memoryId, limit: $limit, offset: $offset) {
      id
      type
      nodeLoc
      appId
      sessionId
      model
      tokensIn
      tokensOut
      createdAt
    }
  }
`;

// ---------------------------------------------------------------------------
// GitHub App
// ---------------------------------------------------------------------------

export const LINK_GITHUB_APP_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation LinkGithubApp($orgId: ID!, $installationId: Int!) {
    linkGithubApp(orgId: $orgId, installationId: $installationId) { ...OrgFields }
  }
`;

export const UPDATE_ORG_GITHUB_APP_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation UpdateOrgGithubApp($orgId: ID!, $appId: String!, $privateKey: String!) {
    updateOrgGithubApp(orgId: $orgId, appId: $appId, privateKey: $privateKey) { ...OrgFields }
  }
`;

export const UNLINK_GITHUB_APP_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation UnlinkGithubApp($orgId: ID!) {
    unlinkGithubApp(orgId: $orgId) { ...OrgFields }
  }
`;

// ---------------------------------------------------------------------------
// Node / Edge fragments & queries
// ---------------------------------------------------------------------------

export const NODE_FIELDS = /* GraphQL */ `
  fragment NodeFields on Node {
    id
    memoryId
    memory { id urn name }
    nodeType
    # #588 (server #725): collection discriminator (which domain object this
    # node is, e.g. "competitor"). NULL for an ordinary node. Orthogonal to
    # nodeType. The typed record itself (properties) stays detail-only.
    objectType
    loc
    name
    alias
    description
    abstract
    content
    tokens
    tags
    seq
    data
    ownerRepo
    isRunnable
    createdAt
    updatedAt
    outgoingEdges {
      id
      name
      loc
      isRunnable
      target { id loc name description tags memory { id urn } }
    }
    incomingEdges {
      id
      name
      loc
      isRunnable
      source { id loc name description tags memory { id urn } }
    }
  }
`;

// Unified node search (cor:api:090). `findNodes` supersedes `nodes` + `nodeSearch`;
// results come back under `hits[].node` (envelope shape). Omitting `query` yields a
// filtered list (subsumes the old `nodes`).
//
// `memoryIds` is optional. When callers pass a scope, `findNodes` intersects it with
// the caller's access; naming a system-class memory in the set OVERRIDES the default
// system-class exclusion (a broad, no-memoryIds call hides `class:'system'` memories,
// which the old `nodes` did not — so callers that want an agent's system-memory nodes
// MUST pass its id, e.g. `memoryIds: [systemMemoryId]`). The memory-detail layout
// passes a single id so it only fetches that memory's nodes instead of pulling a
// global window and filtering client-side — the latter silently dropped a memory's
// nodes once total nodes exceeded the limit.
export const GRAPH_NODES_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query GraphNodes($limit: Int, $memoryIds: [ID!]) {
    findNodes(filter: { memoryIds: $memoryIds }, limit: $limit) {
      hits {
        node {
          ...NodeFields
        }
      }
      total
    }
  }
`;

// #447 / hadron-server#466: slim, paginated graph-fetch primitives that scale
// past the ~5000-node ceiling of GRAPH_NODES_QUERY. `memoryNodes` returns only
// what the tree/graph/table draw (no heavy content/abstract/data bodies);
// `memoryEdges` returns endpoint IDs only. Both are loc-ascending and paged
// (default 1000, cap 2000). Callers page each to completion, then map edge
// sourceId/targetId onto the loaded nodes. seq/isRunnable/description added in
// hadron-server#513 so the tree ordering + action dots + graph tooltips keep
// full parity with the old full-node fetch.
export const MEMORY_NODES_QUERY = /* GraphQL */ `
  query MemoryNodes($memoryRef: ID!, $limit: Int, $offset: Int) {
    memoryNodes(memoryRef: $memoryRef, limit: $limit, offset: $offset) {
      nodes { id loc name nodeType tags seq isRunnable description }
      total
    }
  }
`;

export const MEMORY_EDGES_QUERY = /* GraphQL */ `
  query MemoryEdges($memoryRef: ID!, $limit: Int, $offset: Int) {
    memoryEdges(memoryRef: $memoryRef, limit: $limit, offset: $offset) {
      edges { id loc name sourceId targetId }
      total
    }
  }
`;

// Full nodes under a loc subtree (memoryId + loc prefix). Used where a caller
// needs the heavy fields (content/data/createdAt) that the slim memoryNodes
// projection omits — e.g. team-chat messages under `<chat>:messages:`, which
// #447 stopped shipping via the memory layout's graphNodes. `locPrefix` maps to
// a `loc startsWith` match server-side (resolvers.query.node).
export const NODES_BY_LOC_PREFIX_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodesByLocPrefix($memoryId: ID!, $locPrefix: String!, $limit: Int) {
    findNodes(filter: { memoryIds: [$memoryId], locPrefix: $locPrefix }, limit: $limit) {
      hits { node { ...NodeFields } }
    }
  }
`;

// Node CONTENT search (issue #355) — keyword/FTS over name+description+content,
// scoped to a SET of memories (`filter.memoryIds`). Backs the "Exact" toggle of the
// MemoryBrowser search box; powers /api/nodes/search. NOTE: `mode:keyword` is now
// FTS-ranked (whole-token match, name hits above buried body hits) rather than raw
// substring — the old "Exact" substring behaviour changes slightly, but keyword is
// injection-safe (unlike `mode:regex`) for arbitrary search-box input.
// Unified node find — backs /api/nodes/search for all of: text search
// (keyword/hybrid), the net-new structured filters (createdBy = "my nodes",
// updatedAfter/Before = "changed since"), and user-selectable sort. `query` is
// optional — omitting it returns a deterministically-ordered filtered list
// (cor:api:090). #429.
export const NODE_FIND_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodeFind(
    $query: String
    $mode: FindNodesMode
    $sort: NodeSort
    $granularity: SearchGranularity
    $fields: [NodeField!]
    $memoryIds: [ID!]
    $createdBy: String
    $updatedAfter: String
    $updatedBefore: String
    $includeDeleted: Boolean
    $objectType: String
    $where: NodeWhereInput
    $sortProperty: NodePropertySort
    $limit: Int
  ) {
    findNodes(
      query: $query
      mode: $mode
      sort: $sort
      # #589 (server #719): order by a properties/data JSON path; overrides
      # the sort enum when present. Missing/unparseable values sort last.
      sortProperty: $sortProperty
      granularity: $granularity
      # #433: fields is a lexical scoring weight-mask (cor:api:090:03), not a
      # hard filter; ignored by the server for vector/hybrid retrieval.
      fields: $fields
      limit: $limit
      filter: {
        memoryIds: $memoryIds
        createdBy: $createdBy
        updatedAfter: $updatedAfter
        updatedBefore: $updatedBefore
        # #433: surface soft-deleted nodes (admin/audit/restore); default false.
        includeDeleted: $includeDeleted
        # #589 (server #725/#719): collection facet + structured predicate
        # over the properties/data JSONB.
        objectType: $objectType
        where: $where
      }
    ) {
      hits {
        node {
          ...NodeFields
        }
        # #432: per-hit relevance + vector metadata. score is null for an
        # unscored (no-query) filtered list; vector is present only when the
        # hit came from the vector index (fuzzy / hybrid).
        score
        vector {
          similarity
          model
          abstractStale
          source
        }
      }
      # #430: matching-passage snippets (granularity:chunk, mode:vector only).
      passages {
        parentNodeId
        text
        score
      }
      total
      reason
      degraded
    }
  }
`;

// Node SEMANTIC search (issue #355) — vector/hybrid over embedded content, scoped
// to the same memory set. Backs the "Fuzzy" toggle. `reason`/`degraded` surface
// no-vector-index / embedding-unavailable so the UI can nudge the user to Exact.

// #335: a bare-loc ref is memory-blind — the same loc can exist in many
// memories and the server REJECTS an unscoped collision (AMBIGUOUS_NODE_LOC).
// `$memory` is required (ID!) so this query can never run unscoped; both
// callers (reorder API + memory node page) always have the memory id.
// hadron-server#473/#542: node(loc:, memory:) is now node(ref:, memoryRef:) —
// ref accepts a bare loc, still scoped by memoryRef.
// raw: true — #485: node(ref:) compiles Mustache templates on read by
// default, so an authoring surface that round-trips content would silently
// overwrite the template source with its rendered output on the next save
// ({{age}} destroyed). Every portal consumer of these queries is an editor
// or a metadata read, never a template-rendering display — so they always
// read the source. (List queries — findNodes/appNodes — never compile.)
export const NODE_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query Node($loc: ID!, $memory: ID!) {
    node(ref: $loc, memoryRef: $memory, raw: true) {
      ...NodeFields
    }
  }
`;

// #262: resolve a `urn:<type>:`-prefixed URN to the ids the /app/u/<urn>
// route needs to redirect to the resource's canonical page. Returns null
// when unresolvable OR the caller lacks access (collapsed to a 404 by the
// route, so existence is never disclosed).
export const RESOLVE_URN_QUERY = /* GraphQL */ `
  query ResolveUrn($urn: String!) {
    resolveUrn(urn: $urn) {
      kind
      id
      memoryId
      organizationId
    }
  }
`;

// hadron-server#473: nodeById(id:) is now the uniform node(ref:) — ref
// accepts a PK. Result key is \`node\`.
// raw: true — #485, see NODE_QUERY above: the node detail page is the
// content EDITOR; it must round-trip the template source verbatim.
export const NODE_BY_ID_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodeById($id: ID!) {
    node(ref: $id, raw: true) {
      ...NodeFields
      # #518: properties is detail-only — kept OUT of the shared NodeFields
      # fragment so it doesn't bloat search/list payloads (NODE_FIND_QUERY
      # spreads the same fragment; PR #523 review, codex).
      properties
    }
  }
`;

// Server-rendered single-node export (#421 / hadron-server #386). The server
// owns the format — full:true is the canonical file (byte-identical to
// `hadron node export`), full:false renders the selected presentation sections.
export const NODE_EXPORT_QUERY = /* GraphQL */ `
  query NodeExport($id: ID!, $format: NodeExportFormat, $full: Boolean, $sections: [NodeExportSection!]) {
    nodeExport(id: $id, format: $format, full: $full, sections: $sections) {
      format
      mimeType
      filename
      encoding
      data
      bytes
    }
  }
`;

// hadron-server#460 (spec 039 Phase 0): upsertNode is split into
// createNode (create-only; a live node at (memoryId, loc) rejects with
// extensions.code 'NodeLocConflictError') and updateNode (never creates —
// 'NODE_NOT_FOUND' on miss; every content field optional, omitted =
// preserved). updateNode selects its target by `id` (PK or node URN) XOR
// (`memoryId` + `loc`).
export const CREATE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation CreateNode($input: CreateNodeInput!) {
    createNode(input: $input) { ...NodeFields }
  }
`;

export const UPDATE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpdateNode($input: UpdateNodeInput!) {
    updateNode(input: $input) { ...NodeFields }
  }
`;

// hadron-server#542: deleteNode collapsed (loc, memoryId) into a single
// nodeRef (a node PK or fully-qualified URN).
// hard: true permanently removes the row (vs. the default soft-delete's
// deletedAt). #503.
export const DELETE_NODE_MUTATION = /* GraphQL */ `
  mutation DeleteNode($nodeRef: ID!, $hard: Boolean) {
    deleteNode(nodeRef: $nodeRef, hard: $hard)
  }
`;

export const MEMORY_USAGE_SUMMARY_QUERY = /* GraphQL */ `
  query MemoryUsageSummary($memoryRef: ID!) {
    memoryUsageSummary(memoryRef: $memoryRef) {
      nodeLoc
      type
      count
    }
  }
`;

export const NODE_USAGE_QUERY = /* GraphQL */ `
  query NodeUsage($loc: String!, $limit: Int) {
    nodeUsage(loc: $loc, limit: $limit) {
      id
      type
      nodeLoc
      appId
      sessionId
      model
      tokensIn
      tokensOut
      createdAt
    }
  }
`;

// hadron-server#473: myMemories is now the uniform memories() list — same
// default union semantics (own personal/private + member-org owned +
// subscribed; the noisy agent system class stays hidden unless
// filter.memoryClasses names it, unchanged from #468). The portal's only
// caller wants the server default, so no filter is passed. Class filtering
// (e.g. a "show system memories" toggle, #444/#447) will need a separate
// query constant that declares and passes `memoryClasses`.
export const MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query Memories($limit: Int, $offset: Int) {
    memories(limit: $limit, offset: $offset) {
      items {
        ...MemoryFields
      }
      total
    }
  }
`;

// #627: the caller's owner-only memories (personal + private). The loader keeps
// only the USER-OWNED ones (organizationId == null) to present an org-less "My
// memories" list — org-anchored personal memories still live under their org.
export const PERSONAL_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query PersonalMemories($limit: Int, $offset: Int) {
    memories(filter: { memoryClasses: [personal, private] }, limit: $limit, offset: $offset) {
      items {
        ...MemoryFields
      }
      total
    }
  }
`;

// #629 / #636: the dashboard fetches everything it needs in ONE request:
//  - a bounded (limit 5) SLIM memory projection for the "Your memories" preview
//    + total (review: don't fetchAllItems for a count),
//  - the caller's placed widgets (dashboardWidgets, ordered by position), and
//  - the combined per-widget-type data (dashboardWidgetData) — server #772/#773.
// The portal maps the server enum to WidgetType and fans the data out by type.
export const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard {
    memories(filter: { memoryClasses: [personal, private] }, limit: 5) {
      items {
        id
        name
        urn
        class
      }
      total
    }
    agents(limit: 0) {
      total
    }
    dashboardWidgets {
      type
      span
      position
    }
    dashboardWidgetData {
      type
      data
    }
  }
`;

// hadron-server#564 (#501): moveNode reshaped to the <object>Ref convention —
// sourceRef (PK or URN) + exactly ONE of targetUrn (full destination node
// URN: new loc and/or new memory) / targetMemoryRef (same loc, new memory).
// An occupied destination fails loudly with NODE_ALREADY_EXISTS — never a
// silent overwrite.
export const MOVE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation MoveNode($sourceRef: ID!, $targetUrn: String, $targetMemoryRef: ID) {
    moveNode(sourceRef: $sourceRef, targetUrn: $targetUrn, targetMemoryRef: $targetMemoryRef) { ...NodeFields }
  }
`;

// #564's sibling: copy a node (same selector shape as moveNode; returns the
// NEW node). Backs the node page's "Duplicate" action (#501).
export const CLONE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation CloneNode($sourceRef: ID!, $targetUrn: String, $targetMemoryRef: ID) {
    cloneNode(sourceRef: $sourceRef, targetUrn: $targetUrn, targetMemoryRef: $targetMemoryRef) { ...NodeFields }
  }
`;

// ---------------------------------------------------------------------------
// Exchange integration
// ---------------------------------------------------------------------------

export const DELETE_EXCHANGE_CONNECTION_MUTATION = /* GraphQL */ `
  mutation DeleteExchangeConnection($id: ID!) {
    deleteExchangeConnection(id: $id)
  }
`;

export const TEST_EXCHANGE_CONNECTION_MUTATION = /* GraphQL */ `
  mutation TestExchangeConnection($id: ID!) {
    testExchangeConnection(id: $id)
  }
`;

// ---------------------------------------------------------------------------
// Apps (multi-user agent callers)
// ---------------------------------------------------------------------------

// hadron-server#473: apps(orgId!) is now the uniform paginated apps() list
// (orgId optional; member-gated — the myApps exposure bar, relaxed from
// org-ADMIN).
export const APPS_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query Apps($orgId: ID, $limit: Int, $offset: Int) {
    apps(orgId: $orgId, limit: $limit, offset: $offset) {
      items { ...AppFields }
      total
    }
  }
`;

// Slim app list — just enough to map an installed agent → its App (id/name).
// Used by the org agents page to show an "Open" button for already-installed
// agents without pulling the heavy AppFields (agent/keys/memory) payload.
export const ORG_APP_INSTALLS_QUERY = /* GraphQL */ `
  query OrgAppInstalls($orgId: ID, $limit: Int, $offset: Int) {
    apps(orgId: $orgId, limit: $limit, offset: $offset) {
      items { id name agentId }
      total
    }
  }
`;

// ---------------------------------------------------------------------------
// Headless runs (spec 040 / #478) — the audit surface + kill switch
// ---------------------------------------------------------------------------

// NOTE: `data` (the run envelope) is deliberately NOT in this fragment —
// it needs hadron-server#534 and is fetched separately (best-effort) by
// APP_RUN_ENVELOPE_QUERY so the run pages work against older servers.
export const APP_RUN_FIELDS = /* GraphQL */ `
  fragment AppRunFields on AppRun {
    id
    organizationId
    appId
    agentId
    userId
    triggerKind
    triggerId
    entryNodeUrn
    eventData
    budgetTokens
    budgetActions
    status
    curNodeUrn
    parentRunId
    failure
    timeoutMs
    attempts
    startedAt
    finishedAt
    createdAt
    createdBy
  }
`;

// The runs audit list (org-READER gated server-side; limit hard-capped 200).
export const APP_RUNS_QUERY = /* GraphQL */ `
  ${APP_RUN_FIELDS}
  query AppRuns($appRef: String, $status: AppRunStatus, $limit: Int, $offset: Int) {
    appRuns(appRef: $appRef, status: $status, limit: $limit, offset: $offset) {
      items { ...AppRunFields }
      total
    }
  }
`;

export const APP_RUN_QUERY = /* GraphQL */ `
  ${APP_RUN_FIELDS}
  query AppRun($id: ID!) {
    appRun(ref: $id) {
      ...AppRunFields
    }
  }
`;

// The run envelope — separate query because `AppRun.data` only exists from
// hadron-server#534 on; the detail loader degrades gracefully when the
// field is unknown instead of erroring the whole page.
export const APP_RUN_ENVELOPE_QUERY = /* GraphQL */ `
  query AppRunEnvelope($id: ID!) {
    appRun(ref: $id) {
      id
      data
    }
  }
`;

// The kill switch (guarded server-side: only a still-RUNNING/PENDING row
// transitions; a raced terminal state survives in the audit log).
export const CANCEL_APP_RUN_MUTATION = /* GraphQL */ `
  ${APP_RUN_FIELDS}
  mutation CancelAppRun($id: ID!) {
    cancelAppRun(id: $id) {
      ...AppRunFields
    }
  }
`;

// "Test this flow" (#478): runTask with appRef mints a MANUAL AppRun and
// returns its id (#529) — the walker executes it in the background.
export const RUN_TASK_APP_MUTATION = /* GraphQL */ `
  mutation RunTaskApp($urn: String!, $args: JSON, $appRef: ID!, $runAsSelf: Boolean) {
    runTask(urn: $urn, args: $args, appRef: $appRef, runAsSelf: $runAsSelf)
  }
`;

// Apps an agent is installed into — for the agent detail page's Apps tab.
// Omit orgId so `apps` is member-scoped to EVERY app across the caller's orgs
// (an agent can be installed cross-org). Both `agentId` (primary) and the full
// `agents` join list are selected so a many-to-many install is caught, and
// `App.agents` is member-readable (unlike the admin-gated `Agent.apps`), so
// non-admin members see this too.
export const AGENT_APPS_QUERY = /* GraphQL */ `
  query AgentApps($limit: Int, $offset: Int) {
    apps(limit: $limit, offset: $offset) {
      items { id name urn organizationId agentId agents { id } }
      total
    }
  }
`;

// App queries/mutations are defined earlier in this file (above the
// Memory section) — APP_QUERY, CREATE_APP_MUTATION, UPDATE_APP_MUTATION,
// DELETE_APP_MUTATION, ADD_AGENT_TO_APP_MUTATION,
// REMOVE_AGENT_FROM_APP_MUTATION, CREATE_APP_KEY_MUTATION,
// REVOKE_APP_KEY_MUTATION.

// ---------------------------------------------------------------------------
// Spec 025-oauth-for-mcp: user-scoped API keys (Bearer credentials for MCP).
// The /app/account/api-keys page reads + mutates via these three ops.
// ---------------------------------------------------------------------------

export const MY_USER_API_KEYS_QUERY = /* GraphQL */ `
  query MyUserApiKeys {
    myUserApiKeys {
      id
      keyPreview
      label
      createdAt
      lastUsedAt
      revokedAt
      issuedVia
    }
  }
`;

export const CREATE_USER_API_KEY_MUTATION = /* GraphQL */ `
  mutation CreateUserApiKey($label: String) {
    createUserApiKey(label: $label) {
      userApiKey {
        id
        keyPreview
        label
        createdAt
        lastUsedAt
        revokedAt
        issuedVia
      }
      rawKey
    }
  }
`;

export const REVOKE_USER_API_KEY_MUTATION = /* GraphQL */ `
  mutation RevokeUserApiKey($id: ID!) {
    revokeUserApiKey(id: $id) {
      id
      keyPreview
      label
      createdAt
      lastUsedAt
      revokedAt
      issuedVia
    }
  }
`;

// ---------------------------------------------------------------------------
// Access check (#375) — backs the "Check access" command page. Mirrors the CLI
// `hadron access check <user> <resource>`; see hadron-server effectiveAccess.
// ---------------------------------------------------------------------------

export const EFFECTIVE_ACCESS_QUERY = /* GraphQL */ `
  query EffectiveAccess($user: ID!, $resource: ID!) {
    effectiveAccess(user: $user, resource: $resource) {
      user {
        id
        handle
        name
        email
      }
      resourceUrn
      resourceKind
      canRead
      canWrite
      canManage
      canDelete
      role
      grants {
        source
        role
        via
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Merge node (#395) — backs the "Merge node" command page. Mirrors the CLI
// `hadron node merge`; folds a source node into a target. See hadron-server
// mergeNodes / MergeNodesInput / NodeMergeField.
// ---------------------------------------------------------------------------

export const MERGE_NODES_MUTATION = /* GraphQL */ `
  mutation MergeNodes($input: MergeNodesInput!) {
    mergeNodes(input: $input) {
      id
      memoryId
      loc
      name
    }
  }
`;

// ---------------------------------------------------------------------------
// Merge memory (#396) — backs the "Merge memory" command page. Mirrors the CLI
// `hadron memory merge`; empties a source memory into a target. See
// hadron-server mergeMemories / MergeMemoriesInput.
// ---------------------------------------------------------------------------

export const MERGE_MEMORIES_MUTATION = /* GraphQL */ `
  mutation MergeMemories($input: MergeMemoriesInput!) {
    mergeMemories(input: $input) {
      id
      urn
      name
    }
  }
`;

// ---------------------------------------------------------------------------
// List tasks (#392) — backs the "List tasks" command page. Runnable nodes
// (Node.isRunnable=true) across every memory the caller can access (findNodes
// applies the access filter when no memory scope is given). Results come back
// under `hits[].node`.
// ---------------------------------------------------------------------------

export const RUNNABLE_NODES_QUERY = /* GraphQL */ `
  query RunnableNodes($limit: Int, $memoryIds: [ID!]) {
    findNodes(filter: { memoryIds: $memoryIds, isRunnable: true }, limit: $limit) {
      hits {
        node {
          id
          memoryId
          loc
          name
          description
          nodeType
          memory {
            id
            urn
            name
          }
        }
      }
    }
  }
`;
