// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export const GRAPH_FIELDS = /* GraphQL */ `
  fragment GraphFields on Graph {
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
    organizationId
    userId
    expiresAt
    createdAt
    lastUsedAt
  }
`;

export const CLIENT_BUNDLE_SUB_FIELDS = /* GraphQL */ `
  fragment ClientBundleSubFields on ClientBundleSub {
    id
    bundle {
      id
      name
      description
    }
    subscriptionType
    trainingMode
    createdAt
  }
`;

export const GRAPH_BUNDLE_FIELDS = /* GraphQL */ `
  fragment GraphBundleFields on GraphBundle {
    id
    organizationId
    name
    description
    graphs {
      id
      graph { id name }
    }
    createdAt
  }
`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const PUBLIC_GRAPHS_QUERY = /* GraphQL */ `
  ${GRAPH_FIELDS}
  query PublicGraphs {
    publicGraphs {
      ...GraphFields
    }
  }
`;

export const MY_ORGANIZATIONS_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${GRAPH_FIELDS}
  query MyOrganizations {
    myOrganizations {
      ...OrgFields
      members {
        id
        role
        user { id githubUsername name avatarUrl email }
      }
      graphs {
        ...GraphFields
      }
    }
  }
`;

export const ORGANIZATION_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${GRAPH_FIELDS}
  ${GRAPH_BUNDLE_FIELDS}
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
      graphs {
        ...GraphFields
        subscriptions {
          id
          role
          organization { id name domain }
        }
      }
      graphBundles {
        ...GraphBundleFields
      }
      subscriptions {
        id
        role
        activated
        graph { ...GraphFields }
        organization { id name domain }
      }
    }
  }
`;

export const MY_CLIENTS_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_BUNDLE_SUB_FIELDS}
  query MyClients {
    myClients {
      ...ClientFields
      bundleSubscriptions { ...ClientBundleSubFields }
    }
  }
`;

export const CLIENT_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_BUNDLE_SUB_FIELDS}
  query Client($id: ID!) {
    client(id: $id) {
      ...ClientFields
      user { id githubUsername name avatarUrl email }
      bundleSubscriptions { ...ClientBundleSubFields }
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
  mutation AddOrganizationMember($orgId: ID!, $userId: ID!, $role: Role!) {
    addOrganizationMember(orgId: $orgId, userId: $userId, role: $role) {
      id role canInvite createdAt
      user { id githubUsername name avatarUrl email }
    }
  }
`;

export const UPDATE_MEMBER_MUTATION = /* GraphQL */ `
  mutation UpdateOrganizationMember($orgId: ID!, $userId: ID!, $role: Role!) {
    updateOrganizationMember(orgId: $orgId, userId: $userId, role: $role) {
      id role
      user { id githubUsername name avatarUrl email }
    }
  }
`;

export const REMOVE_MEMBER_MUTATION = /* GraphQL */ `
  mutation RemoveOrganizationMember($orgId: ID!, $userId: ID!) {
    removeOrganizationMember(orgId: $orgId, userId: $userId)
  }
`;

export const CREATE_GRAPH_MUTATION = /* GraphQL */ `
  ${GRAPH_FIELDS}
  mutation CreateGraph(
    $orgId: ID!, $name: String!, $source: String,
    $readBranch: String, $writeBranch: String, $visibility: Visibility
  ) {
    createGraph(
      orgId: $orgId, name: $name, source: $source,
      readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility
    ) { ...GraphFields }
  }
`;

export const UPDATE_GRAPH_MUTATION = /* GraphQL */ `
  ${GRAPH_FIELDS}
  mutation UpdateGraph(
    $id: ID!, $source: String, $readBranch: String,
    $writeBranch: String, $visibility: Visibility
  ) {
    updateGraph(
      id: $id, source: $source, readBranch: $readBranch,
      writeBranch: $writeBranch, visibility: $visibility
    ) { ...GraphFields }
  }
`;

export const DELETE_GRAPH_MUTATION = /* GraphQL */ `
  mutation DeleteGraph($id: ID!) { deleteGraph(id: $id) }
`;

export const SYNC_GRAPH_MUTATION = /* GraphQL */ `
  ${GRAPH_FIELDS}
  mutation SyncGraph($id: ID!) {
    syncGraph(id: $id) { ...GraphFields }
  }
`;

export const SET_GRAPH_SOURCE_TOKEN_MUTATION = /* GraphQL */ `
  ${GRAPH_FIELDS}
  mutation SetGraphSourceToken($id: ID!, $token: String!, $expiresAt: String) {
    setGraphSourceToken(id: $id, token: $token, expiresAt: $expiresAt) { ...GraphFields }
  }
`;

export const CREATE_GRAPH_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateGraphSubscription($graphId: ID!, $orgId: ID!, $role: Role!) {
    createGraphSubscription(graphId: $graphId, orgId: $orgId, role: $role) {
      id role createdAt
      graph { id name }
      organization { id name domain }
    }
  }
`;

export const DELETE_GRAPH_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation DeleteGraphSubscription($graphId: ID!, $orgId: ID!) {
    deleteGraphSubscription(graphId: $graphId, orgId: $orgId)
  }
`;

// ---------------------------------------------------------------------------
// Graph Bundle mutations
// ---------------------------------------------------------------------------

export const CREATE_GRAPH_BUNDLE_MUTATION = /* GraphQL */ `
  ${GRAPH_BUNDLE_FIELDS}
  mutation CreateGraphBundle($orgId: ID!, $name: String!, $description: String) {
    createGraphBundle(orgId: $orgId, name: $name, description: $description) { ...GraphBundleFields }
  }
`;

export const UPDATE_GRAPH_BUNDLE_MUTATION = /* GraphQL */ `
  ${GRAPH_BUNDLE_FIELDS}
  mutation UpdateGraphBundle($id: ID!, $name: String, $description: String) {
    updateGraphBundle(id: $id, name: $name, description: $description) { ...GraphBundleFields }
  }
`;

export const DELETE_GRAPH_BUNDLE_MUTATION = /* GraphQL */ `
  mutation DeleteGraphBundle($id: ID!) { deleteGraphBundle(id: $id) }
`;

export const ADD_GRAPH_TO_BUNDLE_MUTATION = /* GraphQL */ `
  ${GRAPH_BUNDLE_FIELDS}
  mutation AddGraphToBundle($bundleId: ID!, $graphId: ID!) {
    addGraphToBundle(bundleId: $bundleId, graphId: $graphId) { ...GraphBundleFields }
  }
`;

export const REMOVE_GRAPH_FROM_BUNDLE_MUTATION = /* GraphQL */ `
  ${GRAPH_BUNDLE_FIELDS}
  mutation RemoveGraphFromBundle($bundleId: ID!, $graphId: ID!) {
    removeGraphFromBundle(bundleId: $bundleId, graphId: $graphId) { ...GraphBundleFields }
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
    $organizationId: String, $userId: String, $expiresAt: String
  ) {
    createClient(
      label: $label, clientType: $clientType, role: $role,
      description: $description, namespace: $namespace,
      organizationId: $organizationId, userId: $userId, expiresAt: $expiresAt
    ) {
      rawKey
      client { ...ClientFields }
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

export const SUBSCRIBE_CLIENT_TO_BUNDLE_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_BUNDLE_SUB_FIELDS}
  mutation SubscribeClientToBundle($clientId: ID!, $bundleId: ID!, $subscriptionType: SubscriptionType, $trainingMode: Boolean) {
    subscribeClientToBundle(clientId: $clientId, bundleId: $bundleId, subscriptionType: $subscriptionType, trainingMode: $trainingMode) {
      ...ClientFields
      bundleSubscriptions { ...ClientBundleSubFields }
    }
  }
`;

export const UNSUBSCRIBE_CLIENT_FROM_BUNDLE_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${CLIENT_BUNDLE_SUB_FIELDS}
  mutation UnsubscribeClientFromBundle($clientId: ID!, $bundleId: ID!) {
    unsubscribeClientFromBundle(clientId: $clientId, bundleId: $bundleId) {
      ...ClientFields
      bundleSubscriptions { ...ClientBundleSubFields }
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
    graphId
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

export const GRAPH_USAGE_SUMMARY_QUERY = /* GraphQL */ `
  query GraphUsageSummary($graphId: ID!) {
    graphUsageSummary(graphId: $graphId) {
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

export const MOVE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation MoveNode($from: String!, $to: String!) {
    moveNode(from: $from, to: $to) { ...NodeFields }
  }
`;
