// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export const MEMORY_FIELDS = /* GraphQL */ `
  fragment MemoryFields on Memory {
    id
    organizationId
    name
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
    domain
    isVisible
    githubInstallationId
    githubAppId
    hasGithubAppPrivateKey
    createdAt
    updatedAt
  }
`;

export const CLIENT_FIELDS = /* GraphQL */ `
  fragment ClientFields on Client {
    id
    label
    clientType
    description
    role
    apiKeyShown
    namespace
    agentTools
    organizationId
    userId
    expiresAt
    createdAt
    lastUsedAt
  }
`;

export const CLIENT_AGENT_SUB_FIELDS = /* GraphQL */ `
  fragment ClientAgentSubFields on ClientAgentSub {
    id
    agent {
      id
      name
      description
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
    name
    description
    memoryItems {
      id
      memory { id name }
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
      githubUsername
      name
      avatarUrl
      email
      roles
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
  query MyOrganizations {
    myOrganizations {
      ...OrgFields
      members {
        id
        role
        user { id githubUsername name avatarUrl email }
      }
      memories {
        ...MemoryFields
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
        user { id githubUsername name avatarUrl email }
      }
      memories {
        ...MemoryFields
        subscriptions {
          id
          role
          organization { id name domain }
        }
      }
      agents {
        ...AgentFields
      }
      subscriptions {
        id
        role
        activated
        memory { ...MemoryFields }
        organization { id name domain }
      }
    }
  }
`;

export const MY_CLIENTS_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_AGENT_SUB_FIELDS}
  query MyClients {
    myClients {
      ...ClientFields
      agentSubscriptions { ...ClientAgentSubFields }
    }
  }
`;

export const CLIENT_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_AGENT_SUB_FIELDS}
  query Client($id: ID!) {
    client(id: $id) {
      ...ClientFields
      user { id githubUsername name avatarUrl email }
      agentSubscriptions { ...ClientAgentSubFields }
    }
  }
`;

export const USERS_QUERY = /* GraphQL */ `
  query Users {
    users { id githubUsername name avatarUrl email roles maxReferrals }
  }
`;

export const SEARCH_USERS_QUERY = /* GraphQL */ `
  query SearchUsers($query: String!) {
    searchUsers(query: $query) { id githubUsername name avatarUrl email }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CREATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation CreateOrganization($name: String!, $domain: String!) {
    createOrganization(name: $name, domain: $domain) { ...OrgFields }
  }
`;

export const UPDATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation UpdateOrganization($id: ID!, $name: String, $domain: String) {
    updateOrganization(id: $id, name: $name, domain: $domain) { ...OrgFields }
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
      user { id githubUsername name avatarUrl email }
    }
  }
`;

export const UPDATE_MEMBER_MUTATION = /* GraphQL */ `
  mutation UpdateOrgMember($orgId: ID!, $userId: ID!, $role: Role!) {
    updateOrgMember(orgId: $orgId, userId: $userId, role: $role) {
      id role
      user { id githubUsername name avatarUrl email }
    }
  }
`;

export const REMOVE_MEMBER_MUTATION = /* GraphQL */ `
  mutation RemoveOrgMember($orgId: ID!, $userId: ID!) {
    removeOrgMember(orgId: $orgId, userId: $userId)
  }
`;

export const CREATE_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation CreateMemory(
    $orgId: ID!, $name: String!, $source: String,
    $readBranch: String, $writeBranch: String, $visibility: Visibility
  ) {
    createMemory(
      orgId: $orgId, name: $name, source: $source,
      readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility
    ) { ...MemoryFields }
  }
`;

export const UPDATE_MEMORY_MUTATION = /* GraphQL */ `
  ${MEMORY_FIELDS}
  mutation UpdateMemory(
    $id: ID!, $source: String, $readBranch: String,
    $writeBranch: String, $visibility: Visibility
  ) {
    updateMemory(
      id: $id, source: $source, readBranch: $readBranch,
      writeBranch: $writeBranch, visibility: $visibility
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
      organization { id name domain }
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
  mutation CreateAgent($orgId: ID!, $name: String!, $description: String) {
    createAgent(orgId: $orgId, name: $name, description: $description) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgent($id: ID!, $name: String, $description: String) {
    updateAgent(id: $id, name: $name, description: $description) { ...AgentFields }
  }
`;

export const DELETE_AGENT_MUTATION = /* GraphQL */ `
  mutation DeleteAgent($id: ID!) { deleteAgent(id: $id) }
`;

export const ADD_MEMORY_TO_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation AddMemoryToAgent($agentId: ID!, $memoryId: ID!) {
    addMemoryToAgent(agentId: $agentId, memoryId: $memoryId) { ...AgentFields }
  }
`;

export const REMOVE_MEMORY_FROM_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation RemoveMemoryFromAgent($agentId: ID!, $memoryId: ID!) {
    removeMemoryFromAgent(agentId: $agentId, memoryId: $memoryId) { ...AgentFields }
  }
`;

// ---------------------------------------------------------------------------
// Client mutations
// ---------------------------------------------------------------------------

export const CREATE_CLIENT_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  mutation CreateClient(
    $label: String!, $clientType: ClientType!, $role: Role!,
    $description: String, $namespace: String,
    $organizationId: String, $userId: String, $expiresAt: String,
    $agentTools: [String!]
  ) {
    createClient(
      label: $label, clientType: $clientType, role: $role,
      description: $description, namespace: $namespace,
      organizationId: $organizationId, userId: $userId, expiresAt: $expiresAt,
      agentTools: $agentTools
    ) {
      rawKey
      client { ...ClientFields }
    }
  }
`;

export const UPDATE_CLIENT_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  mutation UpdateClient($id: ID!, $description: String, $agentTools: [String!]) {
    updateClient(id: $id, description: $description, agentTools: $agentTools) {
      ...ClientFields
    }
  }
`;

export const REGENERATE_API_KEY_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  mutation RegenerateApiKey($id: ID!) {
    regenerateApiKey(id: $id) { rawKey client { ...ClientFields } }
  }
`;

export const REVOKE_CLIENT_MUTATION = /* GraphQL */ `
  mutation RevokeClient($id: ID!) { revokeClient(id: $id) }
`;

export const SUBSCRIBE_CLIENT_TO_AGENT_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_AGENT_SUB_FIELDS}
  mutation SubscribeClientToAgent($clientId: ID!, $agentId: ID!, $subscriptionType: SubscriptionType, $trainingMode: Boolean) {
    subscribeClientToAgent(clientId: $clientId, agentId: $agentId, subscriptionType: $subscriptionType, trainingMode: $trainingMode) {
      ...ClientFields
      agentSubscriptions { ...ClientAgentSubFields }
    }
  }
`;

export const UNSUBSCRIBE_CLIENT_FROM_AGENT_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_AGENT_SUB_FIELDS}
  mutation UnsubscribeClientFromAgent($clientId: ID!, $agentId: ID!) {
    unsubscribeClientFromAgent(clientId: $clientId, agentId: $agentId) {
      ...ClientFields
      agentSubscriptions { ...ClientAgentSubFields }
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
    loc
    name
    title
    alias
    description
    content
    tokens
    tags
    namespace
    ownerRepo
    isRunnable
    createdAt
    updatedAt
    outgoingEdges {
      id
      label
      target { id loc name title description tags namespace }
    }
    incomingEdges {
      id
      label
      source { id loc name title description tags namespace }
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
      clientId
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
