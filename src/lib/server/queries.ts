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
    syncStatus
    syncError
    pendingEdgeCount
    lastSyncedAt
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

export const STATION_FIELDS = /* GraphQL */ `
  fragment StationFields on Station {
    id
    urn
    name
    stationType
    description
    role
    agentTools
    organizationId
    userId
    expiresAt
    createdAt
    lastUsedAt
    aiProvider
    aiModel
    hasAiApiKey
  }
`;

export const STATION_AGENT_SUB_FIELDS = /* GraphQL */ `
  fragment StationAgentSubFields on StationAgentSub {
    id
    agent {
      id
      urn
      name
      description
      memoryItems {
        id
        role
        memory { id urn name }
      }
    }
    subscriptionType
    trainingMode
    createdAt
  }
`;

export const AGENT_FIELDS = /* GraphQL */ `
  fragment AgentFields on Agent {
    id
    organizationId
    urn
    name
    description
    visibility
    properties
    memoryItems {
      id
      role
      memory { id urn name visibility }
    }
    createdAt
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
    }
  }
`;

export const ORGANIZATION_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  ${AGENT_FIELDS}
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
    }
  }
`;

export const MY_STATIONS_QUERY = /* GraphQL */ `
  ${STATION_FIELDS}
  ${STATION_AGENT_SUB_FIELDS}
  query MyStations {
    myStations {
      ...StationFields
      agentSubscriptions { ...StationAgentSubFields }
    }
  }
`;

export const STATION_QUERY = /* GraphQL */ `
  ${STATION_FIELDS}
  ${STATION_AGENT_SUB_FIELDS}
  query Station($id: ID!) {
    station(id: $id) {
      ...StationFields
      user { id handle githubUsername name avatarUrl email }
      agentSubscriptions { ...StationAgentSubFields }
    }
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
    $source: String, $readBranch: String, $writeBranch: String, $visibility: MemoryVisibility
  ) {
    createMemory(
      orgId: $orgId, name: $name, shortDescription: $shortDescription, description: $description,
      tags: $tags, license: $license,
      category0: $category0, category1: $category1, category2: $category2,
      iconUrl: $iconUrl, heroUrl: $heroUrl, homeUrl: $homeUrl,
      source: $source, readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility
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
    $source: String, $readBranch: String, $writeBranch: String, $visibility: MemoryVisibility
  ) {
    updateMemory(
      id: $id, name: $name, urn: $urn, organizationId: $organizationId, shortDescription: $shortDescription, description: $description,
      tags: $tags, license: $license,
      category0: $category0, category1: $category1, category2: $category2,
      iconUrl: $iconUrl, heroUrl: $heroUrl, homeUrl: $homeUrl,
      source: $source, readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility
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
  mutation CreateAgent($orgId: ID!, $name: String!, $description: String, $visibility: MemoryVisibility) {
    createAgent(orgId: $orgId, name: $name, description: $description, visibility: $visibility) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgent($id: ID!, $name: String, $urn: String, $description: String, $visibility: MemoryVisibility) {
    updateAgent(id: $id, name: $name, urn: $urn, description: $description, visibility: $visibility) { ...AgentFields }
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
// Station mutations
// ---------------------------------------------------------------------------

export const CREATE_STATION_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  mutation CreateStation(
    $name: String!, $stationType: StationType!, $role: Role!,
    $description: String,
    $organizationId: String, $userId: String, $expiresAt: String,
    $agentTools: [String!]
  ) {
    createStation(
      name: $name, stationType: $stationType, role: $role,
      description: $description,
      organizationId: $organizationId, userId: $userId, expiresAt: $expiresAt,
      agentTools: $agentTools
    ) {
      rawKey
      station { ...StationFields }
    }
  }
`;

export const UPDATE_STATION_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  mutation UpdateStation($id: ID!, $name: String, $urn: String, $stationType: StationType, $description: String, $agentTools: [String!], $aiProvider: String, $aiModel: String, $aiApiKey: String) {
    updateStation(id: $id, name: $name, urn: $urn, stationType: $stationType, description: $description, agentTools: $agentTools, aiProvider: $aiProvider, aiModel: $aiModel, aiApiKey: $aiApiKey) {
      ...StationFields
    }
  }
`;

export const REGENERATE_API_KEY_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  mutation RegenerateApiKey($id: ID!) {
    regenerateApiKey(id: $id) { rawKey station { ...StationFields } }
  }
`;

// ---------------------------------------------------------------------------
// Station Keys
// ---------------------------------------------------------------------------

export const STATION_KEYS_QUERY = /* GraphQL */ `
  query StationKeys($stationId: ID!) {
    stationKeys(stationId: $stationId) {
      id label keyPreview lastUsedAt createdAt revokedAt userId
    }
  }
`;

export const CREATE_STATION_KEY_MUTATION = /* GraphQL */ `
  mutation CreateStationKey($stationId: ID!, $label: String) {
    createStationKey(stationId: $stationId, label: $label) {
      key { id label keyPreview createdAt }
      rawKey
    }
  }
`;

export const REVOKE_STATION_KEY_MUTATION = /* GraphQL */ `
  mutation RevokeStationKey($keyId: ID!) {
    revokeStationKey(keyId: $keyId)
  }
`;

export const REVOKE_STATION_MUTATION = /* GraphQL */ `
  mutation RevokeStation($id: ID!) { revokeStation(id: $id) }
`;

export const SUBSCRIBE_STATION_TO_AGENT_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  ${STATION_AGENT_SUB_FIELDS}
  mutation SubscribeStationToAgent($stationId: ID!, $agentId: ID!, $subscriptionType: SubscriptionType, $trainingMode: Boolean) {
    subscribeStationToAgent(stationId: $stationId, agentId: $agentId, subscriptionType: $subscriptionType, trainingMode: $trainingMode) {
      ...StationFields
      agentSubscriptions { ...StationAgentSubFields }
    }
  }
`;

export const UNSUBSCRIBE_STATION_FROM_AGENT_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  ${STATION_AGENT_SUB_FIELDS}
  mutation UnsubscribeStationFromAgent($stationId: ID!, $agentId: ID!) {
    unsubscribeStationFromAgent(stationId: $stationId, agentId: $agentId) {
      ...StationFields
      agentSubscriptions { ...StationAgentSubFields }
    }
  }
`;

// ---------------------------------------------------------------------------
// Station AI Config (uses updateStation mutation)
// ---------------------------------------------------------------------------

export const UPDATE_STATION_AI_CONFIG_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  mutation UpdateStationAIConfig($id: ID!, $aiProvider: String, $aiModel: String, $aiApiKey: String) {
    updateStation(id: $id, aiProvider: $aiProvider, aiModel: $aiModel, aiApiKey: $aiApiKey) {
      ...StationFields
    }
  }
`;

export const CLEAR_STATION_AI_CONFIG_MUTATION = /* GraphQL */ `
  ${STATION_FIELDS}
  mutation ClearStationAIConfig($id: ID!, $aiProvider: String, $aiModel: String, $aiApiKey: String) {
    updateStation(id: $id, aiProvider: $aiProvider, aiModel: $aiModel, aiApiKey: $aiApiKey) {
      ...StationFields
    }
  }
`;

export const STATION_AI_CONFIG_QUERY = /* GraphQL */ `
  query StationAIConfig($stationId: ID!) {
    stationAIConfig(stationId: $stationId) {
      provider
      apiKey
      model
    }
  }
`;

export const STATION_NODES_QUERY = /* GraphQL */ `
  query StationNodes($stationId: ID!, $limit: Int) {
    stationNodes(stationId: $stationId, limit: $limit) {
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
        label
        target { id loc name }
      }
      incomingEdges {
        id
        label
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
      stationId
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
  query UsageEvents($type: String, $nodeLoc: String, $limit: Int, $offset: Int) {
    usageEvents(type: $type, nodeLoc: $nodeLoc, limit: $limit, offset: $offset) {
      id
      type
      nodeLoc
      stationId
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
    nodeType
    loc
    name
    alias
    description
    content
    tokens
    tags
    seq
    ownerRepo
    isRunnable
    createdAt
    updatedAt
    outgoingEdges {
      id
      label
      target { id loc name description tags }
    }
    incomingEdges {
      id
      label
      source { id loc name description tags }
    }
  }
`;

export const GRAPH_NODES_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query GraphNodes($limit: Int) {
    nodes(limit: $limit) {
      ...NodeFields
    }
  }
`;

export const NODE_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query Node($loc: String!) {
    node(loc: $loc) {
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
  mutation DeleteNode($loc: String!) {
    deleteNode(loc: $loc)
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
      stationId
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
  query MyMemories {
    myMemories {
      ...MemoryFields
    }
  }
`;

export const MOVE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation MoveNode($from: String!, $to: String!) {
    moveNode(from: $from, to: $to) { ...NodeFields }
  }
`;
