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
    isVisible
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

export const MEMORY_BY_ID_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query MemoryById($id: ID!) {
    memory(id: $id) {
      ...MemoryFields
      subscriptions {
        id
        role
        organization { id name urn }
      }
    }
  }
`;

export const ORG_SYSTEM_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query OrgSystemMemories($orgId: ID!) {
    orgSystemMemories(orgId: $orgId) {
      ...MemoryFields
    }
  }
`;

export const PUBLIC_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query PublicMemories {
    publicMemories {
      ...MemoryFields
    }
  }
`;

export const ADD_TO_MY_MEMORIES_MUTATION = /* GraphQL */ `
  mutation AddToMyMemories($memoryId: ID!) {
    addToMyMemories(memoryId: $memoryId)
  }
`;

export const MY_ORGANIZATIONS_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  ${AGENT_FIELDS}
  ${APP_FIELDS}
  query MyOrganizations {
    myOrganizations {
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
    organization(id: $id) {
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

export const MY_APPS_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query MyApps {
    myApps {
      ...AppFields
    }
  }
`;

export const APP_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query App($id: ID!) {
    app(id: $id) {
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
    app(id: $id) {
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

export const USERS_QUERY = /* GraphQL */ `
  query Users {
    users { id handle githubUsername name avatarUrl email roles maxReferrals }
  }
`;

export const SEARCH_USERS_QUERY = /* GraphQL */ `
  query SearchUsers($query: String!) {
    searchUsers(query: $query) { id handle githubUsername name avatarUrl email }
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
    $chunkTokens: Int, $chunkOverlap: Int, $forceFixedSize: Boolean
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
      chunkTokens: $chunkTokens, chunkOverlap: $chunkOverlap, forceFixedSize: $forceFixedSize
    ) { ...MemoryFields }
  }
`;

export const DELETE_MEMORY_MUTATION = /* GraphQL */ `
  mutation DeleteMemory($id: ID!) { deleteMemory(id: $id) }
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

export const APP_KEYS_QUERY = /* GraphQL */ `
  query AppKeys($appId: ID!) {
    appKeys(appId: $appId) {
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

export const AI_SERVICE_CONFIGS_QUERY = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  query AiServiceConfigs($ownerType: AiConfigOwnerType!, $ownerId: ID!) {
    aiServiceConfigs(ownerType: $ownerType, ownerId: $ownerId) {
      ...AiServiceConfigFields
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
  query ResolveAIConfig($name: String, $appId: ID, $agentId: ID) {
    resolveAIConfig(name: $name, appId: $appId, agentId: $agentId) {
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
  query ResolveAiServiceConfigs($appId: ID, $agentId: ID) {
    resolveAiServiceConfigs(appId: $appId, agentId: $agentId) {
      ...AiServiceConfigFields
    }
  }
`;

export const MY_CHATS_QUERY = /* GraphQL */ `
  query MyChats($agentId: ID!, $limit: Int, $offset: Int) {
    myChats(agentId: $agentId, limit: $limit, offset: $offset) {
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
      sourceNodeId: $sourceNodeId
      targetNodeId: $targetNodeId
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
      edgeId: $edgeId
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
export const EDGE_HOST_NODE_QUERY = /* GraphQL */ `
  query EdgeHostNode($id: ID!) {
    nodeById(id: $id) {
      id
      memoryId
      loc
      name
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
        source { id loc name description tags memory { id urn } }
        target { id loc name description tags memory { id urn } }
      }
    }
  }
`;

export const DELETE_EDGE_MUTATION = /* GraphQL */ `
  mutation DeleteEdge($edgeId: ID!) {
    deleteEdge(edgeId: $edgeId)
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
  query AppNodes($appId: ID!, $limit: Int) {
    appNodes(appId: $appId, limit: $limit) {
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

// `memoryIds` is optional: callers that omit it (agents page, fixtures) get the
// historical global behavior (server treats null as "no memory filter"); the
// memory-detail layout passes a single id so it only fetches that memory's
// nodes instead of pulling a global window and filtering client-side — the
// latter silently dropped a memory's nodes once total nodes exceeded the limit.
export const GRAPH_NODES_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query GraphNodes($limit: Int, $memoryIds: [ID!]) {
    nodes(limit: $limit, memoryIds: $memoryIds) {
      ...NodeFields
    }
  }
`;

// Node CONTENT search (issue #355) — exact/substring over name+description+content,
// scoped to a SET of memories (server `memoryIds`, hadron-server#308). Backs the
// "Exact" toggle of the MemoryBrowser search box; powers /api/nodes/search.
export const NODE_CONTENT_SEARCH_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodeContentSearch($memoryIds: [ID!], $search: String, $limit: Int) {
    nodes(memoryIds: $memoryIds, search: $search, limit: $limit) {
      ...NodeFields
    }
  }
`;

// Node SEMANTIC search (issue #355) — vector/hybrid over embedded content, scoped
// to the same memory set. Backs the "Fuzzy" toggle. `reason`/`degraded` surface
// no-vector-index / embedding-unavailable so the UI can nudge the user to Exact.
export const NODE_SEMANTIC_SEARCH_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodeSemanticSearch($query: String!, $memoryIds: [ID!], $mode: SearchMode, $limit: Int) {
    nodeSearch(query: $query, memoryIds: $memoryIds, mode: $mode, limit: $limit) {
      nodes {
        ...NodeFields
      }
      reason
      degraded
    }
  }
`;

// #335: node(loc:) is memory-blind — the same loc can exist in many memories
// and the server now REJECTS an unscoped collision (AMBIGUOUS_NODE_LOC).
// `$memory` is required (ID!) so this query can never run unscoped; both
// callers (reorder API + memory node page) always have the memory id.
export const NODE_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query Node($loc: String!, $memory: ID!) {
    node(loc: $loc, memory: $memory) {
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

export const NODE_BY_ID_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodeById($id: ID!) {
    nodeById(id: $id) {
      ...NodeFields
    }
  }
`;

export const UPSERT_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpsertNode($input: NodeInput!) {
    upsertNode(input: $input) { ...NodeFields }
  }
`;

export const DELETE_NODE_MUTATION = /* GraphQL */ `
  mutation DeleteNode($loc: String!, $memoryId: String!) {
    deleteNode(loc: $loc, memoryId: $memoryId)
  }
`;

export const MEMORY_USAGE_SUMMARY_QUERY = /* GraphQL */ `
  query MemoryUsageSummary($memoryId: ID!) {
    memoryUsageSummary(memoryId: $memoryId) {
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

export const MY_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query MyMemories($includeAgentSystem: Boolean) {
    myMemories(includeAgentSystem: $includeAgentSystem) {
      ...MemoryFields
    }
  }
`;

export const MOVE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation MoveNode($from: String!, $to: String!, $memoryId: String!) {
    moveNode(from: $from, to: $to, memoryId: $memoryId) { ...NodeFields }
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

export const APPS_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query Apps($orgId: ID!) {
    apps(orgId: $orgId) { ...AppFields }
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
