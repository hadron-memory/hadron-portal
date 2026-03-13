// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export const GRAPH_CONFIG_FIELDS = /* GraphQL */ `
  fragment GraphConfigFields on GraphConfig {
    id
    organizationId
    owner { id login name avatarUrl }
    name
    source
    readBranch
    writeBranch
    visibility
    version
    lastSyncedAt
    createdAt
    updatedAt
  }
`;

export const ORG_FIELDS = /* GraphQL */ `
  fragment OrgFields on Organization {
    id
    name
    slug
    githubInstallationId
    owner { id login name avatarUrl }
    createdAt
    updatedAt
  }
`;

export const CLIENT_FIELDS = /* GraphQL */ `
  fragment ClientFields on Client {
    id
    label
    type
    description
    roles
    namespace
    organizationId
    userId
    expiresAt
    createdAt
    lastUsedAt
  }
`;

export const CLIENT_GRAPH_SUB_FIELDS = /* GraphQL */ `
  fragment ClientGraphSubFields on ClientGraphSub {
    id
    subscriptionType
    namespace
    createdAt
    graph { ...GraphConfigFields }
  }
`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const PUBLIC_GRAPHS_QUERY = /* GraphQL */ `
  ${GRAPH_CONFIG_FIELDS}
  query PublicGraphs {
    publicGraphs {
      ...GraphConfigFields
    }
  }
`;

export const MY_ORGANIZATIONS_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  query MyOrganizations {
    myOrganizations {
      ...OrgFields
      members {
        id
        role
        user { id login name avatarUrl }
      }
      graphs {
        ...GraphConfigFields
      }
    }
  }
`;

export const ORGANIZATION_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  query Organization($id: ID!) {
    organization(id: $id) {
      ...OrgFields
      members {
        id
        role
        createdAt
        user { id login name avatarUrl }
      }
      graphs {
        ...GraphConfigFields
        subscriptions {
          id
          role
          organization { id name slug }
        }
      }
      subscriptions {
        id
        role
        graph { ...GraphConfigFields }
      }
    }
  }
`;

export const MY_CLIENTS_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  ${CLIENT_GRAPH_SUB_FIELDS}
  query MyClients {
    myClients {
      ...ClientFields
      subscriptions { ...ClientGraphSubFields }
    }
  }
`;

export const CLIENT_QUERY = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  ${CLIENT_GRAPH_SUB_FIELDS}
  query Client($label: String!) {
    client(label: $label) {
      ...ClientFields
      user { id login name avatarUrl }
      subscriptions { ...ClientGraphSubFields }
    }
  }
`;

export const USERS_QUERY = /* GraphQL */ `
  query Users {
    users { id login name avatarUrl email roles }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CREATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation CreateOrganization($name: String!, $slug: String!) {
    createOrganization(name: $name, slug: $slug) { ...OrgFields }
  }
`;

export const UPDATE_ORGANIZATION_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation UpdateOrganization($id: ID!, $name: String, $slug: String) {
    updateOrganization(id: $id, name: $name, slug: $slug) { ...OrgFields }
  }
`;

export const DELETE_ORGANIZATION_MUTATION = /* GraphQL */ `
  mutation DeleteOrganization($id: ID!) {
    deleteOrganization(id: $id)
  }
`;

export const ADD_MEMBER_MUTATION = /* GraphQL */ `
  mutation AddOrganizationMember($orgId: ID!, $userId: ID!, $role: OrgRole!) {
    addOrganizationMember(orgId: $orgId, userId: $userId, role: $role) {
      id role createdAt
      user { id login name avatarUrl }
    }
  }
`;

export const UPDATE_MEMBER_MUTATION = /* GraphQL */ `
  mutation UpdateOrganizationMember($orgId: ID!, $userId: ID!, $role: OrgRole!) {
    updateOrganizationMember(orgId: $orgId, userId: $userId, role: $role) {
      id role
      user { id login name avatarUrl }
    }
  }
`;

export const REMOVE_MEMBER_MUTATION = /* GraphQL */ `
  mutation RemoveOrganizationMember($orgId: ID!, $userId: ID!) {
    removeOrganizationMember(orgId: $orgId, userId: $userId)
  }
`;

export const CREATE_GRAPH_CONFIG_MUTATION = /* GraphQL */ `
  ${GRAPH_CONFIG_FIELDS}
  mutation CreateGraphConfig(
    $orgId: ID!, $name: String!, $source: String,
    $readBranch: String, $writeBranch: String, $visibility: String, $version: String
  ) {
    createGraphConfig(
      orgId: $orgId, name: $name, source: $source,
      readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility, version: $version
    ) { ...GraphConfigFields }
  }
`;

export const UPDATE_GRAPH_CONFIG_MUTATION = /* GraphQL */ `
  ${GRAPH_CONFIG_FIELDS}
  mutation UpdateGraphConfig(
    $id: ID!, $source: String, $readBranch: String,
    $writeBranch: String, $visibility: String, $version: String
  ) {
    updateGraphConfig(
      id: $id, source: $source, readBranch: $readBranch,
      writeBranch: $writeBranch, visibility: $visibility, version: $version
    ) { ...GraphConfigFields }
  }
`;

export const DELETE_GRAPH_CONFIG_MUTATION = /* GraphQL */ `
  mutation DeleteGraphConfig($id: ID!) { deleteGraphConfig(id: $id) }
`;

export const SYNC_GRAPH_CONFIG_MUTATION = /* GraphQL */ `
  ${GRAPH_CONFIG_FIELDS}
  mutation SyncGraphConfig($id: ID!) {
    syncGraphConfig(id: $id) { ...GraphConfigFields }
  }
`;

export const CREATE_GRAPH_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateGraphSubscription($graphId: ID!, $orgId: ID!, $role: String!) {
    createGraphSubscription(graphId: $graphId, orgId: $orgId, role: $role) {
      id role createdAt
      graph { id name }
      organization { id name slug }
    }
  }
`;

export const DELETE_GRAPH_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation DeleteGraphSubscription($graphId: ID!, $orgId: ID!) {
    deleteGraphSubscription(graphId: $graphId, orgId: $orgId)
  }
`;

export const CREATE_CLIENT_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  mutation CreateClient(
    $label: String!, $type: ClientType!, $roles: [Role!]!,
    $description: String, $namespace: String,
    $organizationId: String, $userId: String, $expiresAt: String
  ) {
    createClient(
      label: $label, type: $type, roles: $roles,
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
  mutation RevokeClient($label: String!) { revokeClient(label: $label) }
`;

export const SUBSCRIBE_CLIENT_TO_GRAPH_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  ${CLIENT_GRAPH_SUB_FIELDS}
  mutation SubscribeClientToGraph($clientId: ID!, $graphId: ID!, $subscriptionType: String, $namespace: String) {
    subscribeClientToGraph(clientId: $clientId, graphId: $graphId, subscriptionType: $subscriptionType, namespace: $namespace) {
      ...ClientFields
      subscriptions { ...ClientGraphSubFields }
    }
  }
`;

export const UNSUBSCRIBE_CLIENT_FROM_GRAPH_MUTATION = /* GraphQL */ `
  ${CLIENT_FIELDS}
  ${GRAPH_CONFIG_FIELDS}
  ${CLIENT_GRAPH_SUB_FIELDS}
  mutation UnsubscribeClientFromGraph($clientId: ID!, $graphId: ID!) {
    unsubscribeClientFromGraph(clientId: $clientId, graphId: $graphId) {
      ...ClientFields
      subscriptions { ...ClientGraphSubFields }
    }
  }
`;

// ---------------------------------------------------------------------------
// Invite fragments, queries & mutations
// ---------------------------------------------------------------------------

export const ORG_INVITE_FIELDS = /* GraphQL */ `
  fragment OrgInviteFields on OrgInvite {
    id
    email
    organization { id name slug }
    invitedBy { id login name avatarUrl }
    status
    token
    createdAt
    expiresAt
  }
`;

export const MY_INVITES_QUERY = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  query MyInvites {
    myInvites { ...OrgInviteFields }
  }
`;

export const ORGANIZATION_INVITES_QUERY = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  query OrganizationInvites($orgId: ID!) {
    organizationInvites(orgId: $orgId) { ...OrgInviteFields }
  }
`;

export const INVITE_BY_TOKEN_QUERY = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  query InviteByToken($token: String!) {
    inviteByToken(token: $token) { ...OrgInviteFields }
  }
`;

export const ACCEPT_INVITE_BY_TOKEN_MUTATION = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  mutation AcceptInviteByToken($token: String!) {
    acceptInviteByToken(token: $token) { ...OrgInviteFields }
  }
`;

export const CREATE_ORGANIZATION_INVITE_MUTATION = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  mutation CreateOrganizationInvite($orgId: ID!, $email: String!) {
    createOrganizationInvite(orgId: $orgId, email: $email) { ...OrgInviteFields }
  }
`;

export const ACCEPT_INVITE_MUTATION = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  mutation AcceptInvite($inviteId: ID!) {
    acceptInvite(inviteId: $inviteId) { ...OrgInviteFields }
  }
`;

export const DECLINE_INVITE_MUTATION = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  mutation DeclineInvite($inviteId: ID!) {
    declineInvite(inviteId: $inviteId) { ...OrgInviteFields }
  }
`;

export const CANCEL_INVITE_MUTATION = /* GraphQL */ `
  ${ORG_INVITE_FIELDS}
  mutation CancelInvite($inviteId: ID!) {
    cancelInvite(inviteId: $inviteId) { ...OrgInviteFields }
  }
`;

// ---------------------------------------------------------------------------
// Ownership transfer
// ---------------------------------------------------------------------------

export const TRANSFER_ORGANIZATION_OWNERSHIP_MUTATION = /* GraphQL */ `
  ${ORG_FIELDS}
  mutation TransferOrganizationOwnership($orgId: ID!, $newOwnerId: ID!) {
    transferOrganizationOwnership(orgId: $orgId, newOwnerId: $newOwnerId) { ...OrgFields }
  }
`;
