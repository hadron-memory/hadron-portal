// The asset projection lives in assetQueries.ts (the asset surface owns it);
// NODE_BY_ID_QUERY spreads it for a reference node's `asset` field. One-way
// dependency — assetQueries.ts imports nothing from here.
import { ASSET_FIELDS } from './assetQueries';

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
    # #841 / hrn:node:hadronmemory.com:specs:cor:acl:080:04 — the marketplace catalogue flag: the catalogue
    # lists memories that are listed AND publicly accessible.
    listedOnMarketplace
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
    # 006-asset-upload-redesign: per-memory upload gate. Default true, false for
    # system-class. The upload affordance is hidden when false; the server
    # rejects with MEMORY_NOT_ACCEPTING_UPLOADS regardless.
    acceptsUploads
    # 008-agent-installation: the App an app/personal-class memory pivots on.
    # NULL for every other class. Carries the appRef the team-chat platform
    # operations need (a team chat lives in its App's shared app-class memory).
    appId
    userId
    userMemoryOfAgentId
    anonymousExpiresAt
    agent { id urn name }
    syncStatus
    syncError
    pendingEdgeCount
    lastSyncedAt
    lastSyncReport
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

    systemMemoryId
    visibility
    type
    surfaces
    personaRole
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
      # description + persona fields feed the Bundled agents grid's Role and
      # Description columns (#713) — without them an import-sourced row rendered
      # an em dash even when the imported agent had values (PR #714 review).
      importedAgent { id urn name description personaRole }
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

    agentTools
    expiresAt
    # App-original fields
    createUserPermission
    identifyUserMethod
    sessionTimeoutSeconds
    anonymousTtlDays
    # 008-agent-installation: direct FK + new App-level fields.
    agentId
    # #1405 (R211): the roles the App offers, the union over its installed
    # Agents, primary first. The members panel reads this, not agent.installationPolicy.
    availableMemberRoles
    agent {
      id
      urn
      name
      description

      surfaces
      memoryItems {
        id
        role
        memory { id urn name }
      }
      installationPolicy { maxMembers memberRoles }
    }
    # #974: the App's install ROSTER (every installed Agent via the AppAgent
    # join) — which role-actors are available to CAST as workers. Distinct from
    # the App's STAFF, which are its Workers (WORKERS_QUERY). personaRole is
    # selected because casting defaults a worker's role to it.
    # Member-readable, unlike the admin-gated Agent.apps.
    agents { id urn name personaRole }
    surfaces
    memberCount
    trainingMode
    # portal#1068: no keys field here. App.keys is manager-only and non-null, so a
    # field error nulls the whole App for every non-manager (hadron-server#2080).
    # The inventory is its own classified request (lib/server/app-keys.ts).
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
      urn
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

// Self-serve account deletion (#662, Apple guideline 5.1.1(v)). No argument —
// the server deletes the caller. Fails with extensions.code 'SOLE_ORG_OWNER'
// (blocking orgs listed in extensions) when the user is the sole owner of
// orgs that still have other members.
export const DELETE_USER_MUTATION = /* GraphQL */ `
  mutation DeleteUser { deleteUser }
`;

export const SEND_CONTACT_MESSAGE_MUTATION = /* GraphQL */ `
  mutation SendContactMessage($name: String!, $email: String!, $message: String!) {
    sendContactMessage(name: $name, email: $email, message: $message)
  }
`;

// hadron-server#473: uniform read surface — find-one queries take \`ref\`
// (PK or URN) instead of \`id\`.
export const MEMORY_BY_ID_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query MemoryById($ref: ID!) {
    memory(ref: $ref) {
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

// `addToMyMemories` was retired server-side in hadron-server#771 (spec 048,
// Phase D): it bookmarked a public memory by subscribing the caller's PERSONAL
// ORG, and personal orgs no longer exist — `MemorySubscription` still has no
// user-scoped form (`@@unique([memoryId, organizationId])`, no user column).
// The portal's callers and the "Use this memory" affordance went with it in
// #681.
//
// #685 restored adoption WITHOUT that mutation coming back, so the sentence
// this comment used to end on — "re-introducing that flow needs a server-side
// capability first" — was wrong by the time it was read. The capability was
// already there under a different name: `addMemoryToAgent`
// (ADD_MEMORY_TO_AGENT_MUTATION below) attaches a PUBLIC memory to an agent the
// caller owns, which is what the marketplace copy always promised. A bookmark
// with no agent attached is still unbuilt; that is a narrower gap than the one
// recorded here before.

// hrn:node:hadronmemory.com:specs:cor:acl:080:04 — the marketplace catalogue: listedOnMarketplace + publicly
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
  query AgentPublic($ref: ID!) {
    agent(ref: $ref) {
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
// shared org payload has cross-route blast radius — see
// `hrn:node:hadronmemory.com:hadron-portal:review:shared-layout-payload-consumers`.
// AgentOrgGrant.agent lazily resolves server-side.
export const ORG_AGENT_GRANTS_QUERY = /* GraphQL */ `
  query OrgAgentGrants($ref: ID!) {
    organization(ref: $ref) {
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
// old myOrganizations semantics — hadron-server hrn:node:hadronmemory.com:specs:cor:api:120:03), so an
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

/**
 * The org fields the DETAIL LAYOUT's chrome needs — breadcrumb, header, tab bar
 * — and nothing else (#845).
 *
 * The point of this query is what it does NOT select. Every nested field on
 * Organization is non-null in the SDL (members, memories, agents, subscriptions
 * and exchangeConnections are all [X!]!) while `organization(ref:)` itself is
 * nullable, so GraphQL null propagation carries ANY nested resolver failure up
 * to `organization` — the payload becomes `data.organization = null` and the
 * layout, which cannot tell that from a missing org, renders "Organization not
 * found" over every tab. One list refusing (exchangeConnections for a
 * non-admin member, say) took out the whole org surface for someone looking at
 * their own org.
 *
 * A selection set of three scalars has no nested resolver that can fail, so the
 * layout's verdict is now about the ORG and nothing else. Tabs that need a list
 * fetch it themselves and degrade on their own.
 *
 * Keep it scalar-only. Adding a nested field here re-opens #845 silently —
 * `hrn:node:hadronmemory.com:hadron-portal:review:shared-layout-payload-consumers`
 * governs changes to this payload.
 */
/**
 * The App detail page's org slice (#851) — and its `…_WITH_AGENTS` variant.
 *
 * `ORGANIZATION_QUERY` was here before, selecting `memories`, `subscriptions`,
 * `exchangeConnections` and the full `...AgentFields` to render a breadcrumb
 * and one permission check. All are non-null lists (`[X!]!`) while
 * `organization(ref:)` is nullable, so ANY of them refusing propagated a null
 * to `organization` and 404'd the App page over data it never draws — the #845
 * mechanism, and
 * `hrn:node:hadronmemory.com:hadron-portal:review:a-route-must-not-invoke-a-resolver-it-does-not-render`.
 *
 * What survives, and why each is genuinely rendered:
 *
 *   - the chrome three — breadcrumb, back link, `<title>`;
 *   - **`members`** — `AiServiceConfigSection` derives `canManage` from
 *     `m.user.id === currentUserId && role in (OWNER, ADMIN)`. Selected at FULL
 *     `OrgMember` width on purpose: narrowing to the two fields it reads would
 *     buy no containment, because the hazard is the list being non-null rather
 *     than how wide its rows are, and it would force a prop-type change on a
 *     component three routes share. Bytes, not safety.
 *   - **`agents { id name urn }`** — only in the `…_WITH_AGENTS` variant, and
 *     only those three, because that is what the install `<select>` draws
 *     (`{a.name} ({a.urn})`, keyed by `a.id`) and what the loader's own
 *     `InstallableAgent` type already says. `...AgentFields` would have dragged
 *     in `memoryItems { memory { … } }` and `imports { importedAgent { … } }`.
 *
 * Two documents rather than one because the picker is conditional: an App that
 * already has an Agent sets `availableAgents` to `[]` regardless, so selecting
 * `agents` for it would invoke a resolver whose result is discarded. The caller
 * picks on `app.agent` — the same predicate the page renders the picker from,
 * NOT `app.agentId`, which can disagree with it (@copilot on #852).
 */
const APP_DETAIL_ORG_FIELDS = /* GraphQL */ `
  fragment AppDetailOrgFields on Organization {
    id
    name
    urn
    members {
      id
      role
      canInvite
      createdAt
      user { id handle githubUsername name avatarUrl email }
    }
  }
`;

export const APP_DETAIL_ORG_QUERY = /* GraphQL */ `
  ${APP_DETAIL_ORG_FIELDS}
  query AppDetailOrg($ref: ID!) {
    organization(ref: $ref) {
      ...AppDetailOrgFields
    }
  }
`;

/**
 * The org slice the MEMORY layout draws (portal#1429, S2a of #1380).
 *
 * `ORGANIZATION_QUERY` was loaded here and shipped `memories`, `agents`,
 * `subscriptions` and `exchangeConnections` into every memory page's layout
 * payload (about 803 KB for one production org) although no memory route reads
 * them. What the routes do read: `id`/`name`/`urn` (breadcrumb, back link, info
 * tab, the node page's runnable-install lookup) and `members` role + user id
 * (the layout's and settings page's own-membership checks).
 *
 * Keep it to those fields. A nested list added here is paid for on every
 * memory page and, being non-null in the SDL, can null `organization` when its
 * resolver refuses — `hrn:node:hadronmemory.com:hadron-portal:review:shared-layout-payload-consumers`
 * governs changes.
 */
export const MEMORY_LAYOUT_ORG_QUERY = /* GraphQL */ `
  query MemoryLayoutOrg($ref: ID!) {
    organization(ref: $ref) {
      id
      name
      urn
      members {
        id
        role
        user { id }
      }
    }
  }
`;

// #1173: bundle an Agent with another (an AgentImport edge). The Org-to-Agent
// license that lets an org install a subscribed Agent also authorizes bundling
// it. The server owns the rules (one level of imports, no cycle, who may);
// the portal shows its sentence.
export const PUBLISH_AGENT_IMPORT_MUTATION = /* GraphQL */ `
  mutation PublishAgentImport($importedAgentRef: ID!, $parentAgentRef: ID!, $position: Int!, $required: Boolean) {
    publishAgentImport(
      importedAgentRef: $importedAgentRef
      parentAgentRef: $parentAgentRef
      position: $position
      required: $required
    ) {
      importedAgentId
    }
  }
`;

/**
 * The agents an org-owned App can install (#1006: the Agents tab's picker).
 *
 * A request of its own, NOT a field on APP_DETAIL_ORG_QUERY: `agents` is a
 * non-null list, so folded into the org document its failure would null the org
 * and 404 the whole page over a picker one tab draws (#851). Asked separately,
 * a refusal costs that picker, and the loader reports it as an error.
 */
export const APP_ORG_AGENTS_QUERY = /* GraphQL */ `
  query AppOrgAgents($ref: ID!) {
    organization(ref: $ref) {
      id
      agents {
        id
        name
        urn
      }
    }
  }
`;

/**
 * #1172: the Agents an org SUBSCRIBES to are AgentOrgGrant rows, not members of
 * `agents`, and installAgentIntoApp accepts them. A request of its OWN, not a
 * field on APP_ORG_AGENTS_QUERY: `agentOrgGrants` is a non-null list, so folded
 * into that document a failure of this resolver would null `organization` and
 * empty the legal owned-agent picker too (portal#1188 review). Asked
 * separately, a failure costs only the subscribed agents. The resolver is
 * org-admin gated and has answered [] to a non-platform-admin owner/admin
 * (hadron-server#2186); that is not a refusal and not handled here.
 */
export const APP_ORG_AGENT_GRANTS_QUERY = /* GraphQL */ `
  query AppOrgAgentGrants($ref: ID!) {
    organization(ref: $ref) {
      id
      agentOrgGrants {
        isActive
        revokedAt
        expiresAt
        agent {
          id
          name
          urn
        }
      }
    }
  }
`;

export const ORG_CHROME_QUERY = /* GraphQL */ `
  query OrgChrome($ref: ID!) {
    organization(ref: $ref) {
      id
      name
      urn
    }
  }
`;


/**
 * Per-tab slices of the org (#845, @codex P1 on #847).
 *
 * Splitting the fat query off the LAYOUT stopped one list from nulling the org
 * for every tab, but it left five tabs sharing one selection set — so
 * `exchangeConnections` refusing for a non-admin member still took out Profile,
 * Memories, Agents and Tasks along with Integrations. A tab must not invoke a
 * resolver it does not render.
 *
 * Each of these selects the lists ONE tab reads, so a refusal reaches only the
 * tab whose data it is. All of them keep `...OrgFields` because every tab wants
 * the org's own scalars, and those cannot fail independently.
 *
 * Adding a list to one of these means that tab now shares that list's failures
 * — which is the whole point, so do it deliberately and say why.
 */
export const ORG_MEMBERS_TAB_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  query OrgMembersTab($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      members {
        id
        role
        canInvite
        createdAt
        user { id handle githubUsername name avatarUrl email }
      }
    }
  }
`;

/** The exchange-connection detail route reads only that list. */
export const ORG_EXCHANGE_CONNECTIONS_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${EXCHANGE_CONNECTION_FIELDS}
  query OrgExchangeConnections($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      exchangeConnections {
        ...ExchangeConnectionFields
      }
    }
  }
`;

export const ORG_PROFILE_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  query OrgProfile($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      members {
        id
        role
        canInvite
        createdAt
        user { id handle githubUsername name avatarUrl email }
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

export const ORG_MEMORIES_TAB_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  query OrgMemoriesTab($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      memories {
        ...MemoryFields
        subscriptions {
          id
          role
          organization { id name urn }
        }
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

export const ORG_AGENTS_TAB_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${AGENT_FIELDS}
  query OrgAgentsTab($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      agents {
        ...AgentFields
      }
    }
  }
`;

export const ORG_INTEGRATIONS_TAB_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${EXCHANGE_CONNECTION_FIELDS}
  query OrgIntegrationsTab($ref: ID!) {
    organization(ref: $ref) {
      ...OrgFields
      members {
        id
        role
        canInvite
        createdAt
        user { id handle githubUsername name avatarUrl email }
      }
      exchangeConnections {
        ...ExchangeConnectionFields
      }
    }
  }
`;

/**
 * The Tasks tab needs only the org's memory IDS — they are the security
 * boundary for RUNNABLE_NODES_QUERY (an empty set must NOT become "every
 * accessible memory"), so this asks for the ids and nothing else.
 */
export const ORG_TASK_MEMORY_IDS_QUERY = /* GraphQL */ `
  query OrgTaskMemoryIds($ref: ID!) {
    organization(ref: $ref) {
      id
      memories { id }
    }
  }
`;

/**
 * #1689 — the org's SYSTEM-class memory ids. `Organization.memories` omits them
 * (prod: 25 ordinary, 32 system, none overlapping), so a scope built from it
 * alone can never list a task that lives in a role agent's system memory. Ids
 * only: they join the scope for RUNNABLE_NODES_QUERY, whose `memoryIds` filter
 * is the boundary — naming a system memory there is what lifts the server's
 * default exclusion. Membership-gated (see ORG_SYSTEM_MEMORIES_QUERY).
 */
export const ORG_SYSTEM_MEMORY_IDS_QUERY = /* GraphQL */ `
  query OrgSystemMemoryIds($orgId: ID!, $limit: Int, $offset: Int) {
    memories(orgId: $orgId, filter: { memoryClasses: [system] }, limit: $limit, offset: $offset) {
      items { id }
      total
    }
  }
`;

/**
 * #879 — what the Task Nodes download needs about its org: the memory ids that
 * scope `skillPlan` (the same security boundary as ORG_TASK_MEMORY_IDS_QUERY —
 * an empty set must never reach the server) and the name the plugin is named
 * after.
 */
export const ORG_SKILL_BUNDLE_QUERY = /* GraphQL */ `
  query OrgSkillBundle($ref: ID!) {
    organization(ref: $ref) {
      id
      name
      memories { id }
    }
  }
`;

/**
 * #1075 — a throwaway persisted Scope, the only way to hand EXPORT a memory set
 * (see SKILL_PLAN_EXPORT_QUERY). Created for one download and deleted after it
 * (soft-delete; the name is free again at once). Organization CONTRIBUTOR+.
 */
export const CREATE_SCOPE_MUTATION = /* GraphQL */ `
  mutation CreateScope($input: CreateScopeInput!) {
    createScope(input: $input) {
      id
    }
  }
`;

export const DELETE_SCOPE_MUTATION = /* GraphQL */ `
  mutation DeleteScope($ref: ID!) {
    deleteScope(ref: $ref)
  }
`;

export const ORGANIZATION_QUERY = /* GraphQL */ `
  ${ORG_FIELDS}
  ${MEMORY_FIELDS}
  ${AGENT_FIELDS}
  ${EXCHANGE_CONNECTION_FIELDS}
  query Organization($ref: ID!) {
    organization(ref: $ref) {
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
  query App($ref: ID!) {
    app(ref: $ref) {
      ...AppFields
      # Spec 021 US1: canonical R2 install URN combining App + Agent
      # identities. Scoped to this query (rather than baked into
      # AppFields) so other consumers of the shared fragment — the
      # list views, mutations, etc. — don't hard-depend on the new
      # server-side field. That keeps the portal deployable against
      # a server that hasn't picked up spec-021-US1 yet without
      # breaking unrelated app queries.
      installedAgentUrn
      defaultChannel { id }
    }
  }
`;

// #1005: the App page's Human Team tab. The members ride their own small
// query, not APP_QUERY, so a members resolver that refuses cannot null the page
// (the loader reports that as `membersError`, distinct from "no members").
export const APP_MEMBERS_QUERY = /* GraphQL */ `
  query AppMembers($ref: ID!) {
    app(ref: $ref) {
      id
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

// 008-agent-installation: members carried separately so the bulk
// myApps/app queries don't have to drag membership rows along.
export const APP_WITH_MEMBERS_QUERY = /* GraphQL */ `
  ${APP_FIELDS}
  query AppWithMembers($ref: ID!) {
    app(ref: $ref) {
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

// ── Workers (#974, hrn:node:hadronmemory.com:specs:cor:dmo:050:11) ────────────────────────────────────────
//
// A Worker is the named CASTING of an installed Agent into an App — "Iris",
// the backend-engineer agent cast into eng-team. The App's STAFF are its
// Workers; the AppAgent join (App.agents) is only the install ROSTER, i.e.
// which agents are available to cast.
//
// Since #991 a Worker DOES have a URN — `hrn:worker:<root>:<app-slug>:<slug>`,
// computed from the App's URN plus the derived `slug`, not stored. It is the
// identity a worker signs outward-facing artifacts with (hadron-server#1008)
// and resolves through /app/u. `slug` is non-null; `urn` is nullable, and null
// means the App's URN predates the flat grammar-v2 arity this shape needs —
// a fact about the App, not an error.
//
// A PK is still a valid ref everywhere, and names remain unique per App
// forever, which is what lets an App-context surface render the bare name.
const WORKER_FIELDS = /* GraphQL */ `
  fragment WorkerFields on Worker {
    id
    appId
    agentId
    name
    # The URN atom (#991): derived from the name at cast time and permanent
    # thereafter, so it survives a rename and outlives retirement.
    slug
    # hrn:worker:<root>:<app-slug>:<slug> — the identity every worker signs
    # outward-facing artifacts with (hadron-server#1008). Nullable by contract:
    # null when the App's URN predates the flat grammar-v2 arity, so every
    # consumer must tolerate its absence rather than assume a URN exists.
    urn
    role

    memoryId
    retiredAt
    # #1050 — who HOLDS this name, and since when. A hold belongs to a person
    # and survives expiry, a reap and a closed chat session; only an explicit
    # release frees it (hrn:node:hadronmemory.com:specs:cor:agt:020:09).
    #
    # WORKING-STATE fields: behind the worker read gate and MASKED TO NULL ON
    # DENY, exactly like prompt and memoryId above, and unlike
    # name/role/urn. Null therefore means "nobody holds it" OR "you may not
    # see" — the renderer must not collapse the two.
    #
    # DO NOT add these to a Session.worker selection. That path runs a WIDER
    # gate which admits any org member and survives a user leaving the App, so
    # selecting the holder there would let a former member read current
    # staffing off a historical session. SESSIONS_QUERY selects its worker
    # subfields inline for this reason — keep it that way rather than reaching
    # for this fragment when #737 puts sessions on the worker page.
    heldByUserId
    heldAt
    createdAt
    # The role-actor behind the casting. Nullable in the schema, so every
    # consumer must tolerate null rather than assuming the agent resolves.
    agent { id name urn personaRole }
  }
`;

// One worker, for its own page (#735). Selects the App because the page names
// the team a worker belongs to, and because the URN resolver hands over only a
// worker id — Worker.app is what turns that into a link.
//
// `prompt` is deliberately NOT selected. Selecting it re-renders the full boot
// briefing live, which is multi-KB, and dumping that into a page payload is the
// same defect hadron-cli#459 is open about on `worker list --json`. #737 covers
// showing it behind an explicit expand.
/**
 * portal#1142 P4 (hadron-server#1602 / #2120) — write a worker's signature and
 * trailer templates. A variable the caller leaves undefined is ABSENT on the
 * wire, and the server preserves an absent field; it refuses an explicit null,
 * so this is only ever sent text. Never changes the boot prompt: the two are
 * separate forms, so no single submit mixes them.
 */
export const UPDATE_WORKER_SIGNATURE_MUTATION = /* GraphQL */ `
  mutation UpdateWorkerSignature($workerRef: ID!, $signature: String, $trailer: String) {
    updateWorker(workerRef: $workerRef, signature: $signature, trailer: $trailer) {
      id
      signature
      trailer
    }
  }
`;

export const WORKER_QUERY = /* GraphQL */ `
  ${WORKER_FIELDS}
  query Worker($ref: ID!) {
    worker(ref: $ref) {
      ...WorkerFields
      # Profile identity and server-masked working-state signal (#1334/#1149).
      portalUrl
      appUrn
      appName
      ownerName
      hasLiveSession
      # portal#1492: the terminal report, masked to null on the same gate as
      # hasLiveSession. State, reason and age only — never the host label or prompt.
      terminal { status reason checkedAt lastTurnAt }
      # portal#1142 P4 — the signature and trailer TEMPLATES, masked to null for
      # a reader who may not see worker internals. Null is "not shown", never
      # "empty": the empty string is a real, deliverable-as-nothing value.
      signature
      trailer
      app { id name urn organizationId }
      # portal#1067 (hadron-server#1726) — who this worker reports to. Masked on
      # deny like heldByUserId (reportsToRetired answers false), so a null
      # renders as no line, never as "reports to nobody". The nested target is
      # selected HERE only: on the roster it would be one lookup per row, and
      # the roster already holds every target (includeRetired).
      reportsToWorkerId
      reportsToRetired
      reportsTo { id name urn retiredAt }
      # The resolved boot briefing (#737): the agent's template with
      # {{name}}/{{role}} bound, plus any per-worker override. The most literal
      # answer to "who is this" — it is the worker's operating instructions in
      # its own voice.
      #
      # SELECTED HERE, NOT IN WorkerFields, and that is the whole point. This
      # is multi-KB per worker, and the fragment also feeds the Staff tab's
      # roster — putting it there would ship every worker's briefing on every
      # roster render. That is exactly hadron-cli#459, where worker list
      # carried the prompt and cost 68,245 bytes for seven workers against
      # 3,732 without it. One worker on its own page is the get surface, where
      # the briefing belongs; a list is not.
      prompt
    }
  }
`;

// #919 — the workers a USER holds, across the Apps the CALLER may inspect
// (hadron-server#1344). The profile page's Workers tab. The server applies the
// worker read gate before counting or paging, so a viewer sees only workers in
// Apps they can already read; an unknown user, no holds, and holds confined to
// unreadable Apps are the same empty page, by design. Retired castings are
// excluded (includeRetired omitted). appUrn is a gated scalar, so no nested
// App object rides along.
export const HELD_WORKERS_QUERY = /* GraphQL */ `
  query HeldWorkers($userRef: String!, $limit: Int, $offset: Int) {
    heldWorkers(userRef: $userRef, limit: $limit, offset: $offset) {
      items {
        id
        name
        urn
        role
        appId
        appUrn
        heldAt
        hasLiveSession
        lastActiveAt
      }
      total
    }
  }
`;

// The App's staff. Retired castings are hidden unless includeRetired — they
// keep their name reserved forever, so showing them is how a reader
// understands why a name cannot be reused.
export const WORKERS_QUERY = /* GraphQL */ `
  ${WORKER_FIELDS}
  query Workers($appRef: ID!, $includeRetired: Boolean, $limit: Int, $offset: Int) {
    workers(appRef: $appRef, includeRetired: $includeRetired, limit: $limit, offset: $offset) {
      items {
        ...WorkerFields
        # portal#1067 — the roster's Reports to and Last active columns. Kept
        # out of WorkerFields, which also shapes the cast/retire/release
        # payloads that render none of this. The target is resolved from the
        # roster's own rows, not selected nested (see WORKER_QUERY).
        # lastActiveAt is masked to null on deny, like the hold.
        reportsToWorkerId
        reportsToRetired
        lastActiveAt
        # portal#1168 — the AI Team grid's Status and Model family columns, and
        # the role agent's system memory for the ⋯ menu. All masked to null on
        # deny, like lastActiveAt.
        family
        hasLiveSession
        agent { systemMemoryId }
      }
      total
    }
  }
`;

// Cast an ALREADY-INSTALLED agent under a name.
//
// #760: `name` is REQUIRED. hadron-server#1050 removed the Team Agent's
// cast-list register, so omitting it no longer draws the next free name — it is
// refused with WORKER_NAME_REQUIRED. R222: the role follows the selected
// Agent; the portal never sends a role override.
//
// The argument stays `name: String` (nullable) in the SDL because the refusal
// is a RUNTIME one, which keeps it typed and mappable rather than a schema
// rejection; do not read the nullability as "optional".
//
// Typed refusals: WORKER_NAME_TAKEN, WORKER_NAME_REQUIRED,
// WORKER_AGENT_NOT_INSTALLED, WORKER_AGENT_NOT_FOUND, WORKER_AGENT_AMBIGUOUS,
// WORKER_ROLE_OVERRIDE_REFUSED, APP_UNINSTALLED. WORKER_ROLE_NOT_FOUND and the TEAM_AGENT_* codes went with
// the register — they fired only because a nameless cast had to read one.
export const CAST_WORKER_MUTATION = /* GraphQL */ `
  ${WORKER_FIELDS}
  mutation CastWorker($appRef: ID!, $agentRef: ID, $name: String) {
    castWorker(appRef: $appRef, agentRef: $agentRef, name: $name) {
      ...WorkerFields
    }
  }
`;

// End a casting while reserving its name FOREVER. Idempotent.
export const RETIRE_WORKER_MUTATION = /* GraphQL */ `
  ${WORKER_FIELDS}
  mutation RetireWorker($workerRef: ID!) {
    retireWorker(workerRef: $workerRef) { ...WorkerFields }
  }
`;

// #1050 — free a HELD name so somebody else can hold it. NOT the same act as
// retiring, and the portal must not blur them: retiring ends the casting and
// keeps the name reserved forever, while releasing leaves the worker active and
// touches neither its name allocation nor its history. Idempotent on an unheld
// worker.
//
// Two principals, two different acts: the HOLDER releasing their own name, or an
// App/org ADMIN force-releasing somebody else's. The admin path POSTS TO THE
// TEAM CHAT naming who released what and from whom, which is why the UI has to
// say so before the click rather than after.
// #810 re-sync: hadron-server#1124 changed the return type from `Worker` to
// `ReleaseWorkerPayload`, so the old `{ ...WorkerFields }` spread no longer
// validates. The worker moved under `worker`.
//
// The payload's other three fields are selected but NOT yet acted on, and that
// is deliberate rather than an oversight: reading them is free and makes the
// data available to the loader, while CHANGING what the UI says on the back of
// them is a behaviour change with its own copy decisions. Filed separately.
//
// `notified: false` is the one to act on first — it means a notice was OWED and
// FAILED, so the release happened while the team-chat announcement
// `hrn:node:hadronmemory.com:specs:cor:agt:020:09` requires did not. The action
// currently reports plain success in that case.
// #825 — `expectedHolderUserId` asserts WHICH hold this release was aimed at.
// Without it the write is unconditional: the roster is a snapshot, so a hold
// taken between render and click is force-released silently, and the team-chat
// notice `hrn:node:hadronmemory.com:specs:cor:agt:020:09` names a person the
// admin never chose. A mismatch now refuses WORKER_HOLD_STALE instead, carrying
// the hold found at the moment of the write.
//
// `expectUnheld` is the sibling assertion and is deliberately NOT sent: passing
// both is BAD_USER_INPUT, and this control only renders for a KNOWN hold, so
// "expect nobody" is never the assertion this page wants to make.
export const RELEASE_WORKER_MUTATION = /* GraphQL */ `
  ${WORKER_FIELDS}
  mutation ReleaseWorker($workerRef: ID!, $expectedHolderUserId: ID!) {
    releaseWorker(workerRef: $workerRef, expectedHolderUserId: $expectedHolderUserId) {
      worker { ...WorkerFields }
      releasedFrom { id handle name }
      forced
      notified
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
      # portal#1169 (hadron-server#2179): the orgs the viewer shares with each
      # found person, a bounded page; null is 'not shown to you'.
      items { id handle urn githubUsername name avatarUrl email sharedOrganizations(limit: 5) { items { id name urn } total } }
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

// Admin impersonation (read-only support sessions). The token is returned
// exactly once; the portal seats it in the hadron_impersonation cookie and
// never persists it anywhere else.
export const START_IMPERSONATION_MUTATION = /* GraphQL */ `
  mutation StartImpersonation($orgRef: String!, $userRef: String!, $reason: String) {
    startImpersonation(orgRef: $orgRef, userRef: $userRef, reason: $reason) {
      token
      session {
        id
        expiresAt
        targetUser { id handle name }
      }
    }
  }
`;

export const STOP_IMPERSONATION_MUTATION = /* GraphQL */ `
  mutation StopImpersonation($id: ID) {
    stopImpersonation(id: $id) {
      id
      endedAt
    }
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

// P1-c of hadron-server#1523 (team chat #5308/#5313): invitation(slug) is
// readable by anyone holding the slug, signed in or not. Select ONLY what
// /invite/[token] renders: no ids, no invitee identity, no org URN, nothing
// the server has to project for a stranger. These names are also the contract
// for the server's sanitized invite projection, so this query validates
// against the current server and the sanitized one alike.
export const INVITATION_QUERY = /* GraphQL */ `
  query Invitation($slug: String!) {
    invitation(slug: $slug) {
      memberRole maxActivations activationCount expiresAt
      sender { name githubUsername }
      organization { name }
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
    $id: ID!, $name: String, $urn: String, $shortDescription: String, $description: String,
    $tags: [String!], $license: String,
    $category0: String, $category1: String, $category2: String,
    $iconUrl: String, $heroUrl: String, $homeUrl: String,
    $source: String, $readBranch: String, $writeBranch: String, $visibility: MemoryVisibility,
    $listedOnMarketplace: Boolean,
    $vectorIndexEnabled: Boolean, $embeddingSource: EmbeddingSource,
    $acknowledgeVectorInversionRisk: Boolean,
    $chunkTokens: Int, $chunkOverlap: Int, $forceFixedSize: Boolean,
    $schema: JSON
  ) {
    updateMemory(
      id: $id, name: $name, urn: $urn, shortDescription: $shortDescription, description: $description,
      tags: $tags, license: $license,
      category0: $category0, category1: $category1, category2: $category2,
      iconUrl: $iconUrl, heroUrl: $heroUrl, homeUrl: $homeUrl,
      source: $source, readBranch: $readBranch, writeBranch: $writeBranch,
      visibility: $visibility,
      listedOnMarketplace: $listedOnMarketplace,
      vectorIndexEnabled: $vectorIndexEnabled, embeddingSource: $embeddingSource,
      acknowledgeVectorInversionRisk: $acknowledgeVectorInversionRisk,
      chunkTokens: $chunkTokens, chunkOverlap: $chunkOverlap, forceFixedSize: $forceFixedSize,
      schema: $schema
    ) { ...MemoryFields }
  }
`;

// hadron-server#1481: preview and apply share this mutation. Apply always
// supplies expectedNewUrn from the preview so a changed destination URN is
// rejected as STALE_TRANSFER_PREVIEW instead of silently choosing a new one.
export const TRANSFER_MEMORY_OWNERSHIP_MUTATION = /* GraphQL */ `
  mutation TransferMemoryOwnership(
    $memoryRef: ID!, $orgRef: ID, $userRef: ID, $targetClass: MemoryClass!,
    $expectedNewUrn: String, $resetGroupMembers: Boolean!, $dryRun: Boolean!
  ) {
    transferMemoryOwnership(
      memoryRef: $memoryRef, orgRef: $orgRef, userRef: $userRef,
      targetClass: $targetClass, expectedNewUrn: $expectedNewUrn,
      resetGroupMembers: $resetGroupMembers, dryRun: $dryRun
    ) {
      memoryId oldUrn newUrn fromOwner toOwner currentClass targetClass
      canApply applied
      dependents { kind count handling }
      blockers { code message }
    }
  }
`;

export const MEMORY_TRANSFER_ACCESS_QUERY = /* GraphQL */ `
  query MemoryTransferAccess($user: ID!, $resource: ID!) {
    effectiveAccess(user: $user, resource: $resource) { canDelete }
  }
`;

export const DELETE_MEMORY_MUTATION = /* GraphQL */ `
  mutation DeleteMemory($id: ID!) { deleteMemory(id: $id) }
`;

// #695 (server #882, merged in server #883): operator recovery for embeddings
// that failed PERMANENTLY. Re-stamps every live node carrying
// embeddingFailedAt, clears the failure state, wakes the embedding worker, and
// returns HOW MANY were re-stamped.
//
// The return value is a count of nodes QUEUED, not nodes fixed — the worker has
// not run yet when this resolves, so any copy built on it must say what was
// queued rather than what now works
// (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee).
//
// It returns 0 for two different reasons — nothing was failing, and the memory
// is not vector-indexed at all — so a caller that can be in the second state
// must not render the first as an explanation.
//
// Gate: memory owner or org-ADMIN, the same one `updateMemory` uses.
// portal#1346: the "Vector index health" panel. validateMemory has NO check
// filter: it runs every check over the whole memory and `limit` caps the
// combined findings, so the portal keeps EMBED_FAILED client-side. Read-only,
// and a whole-memory scan, so it only runs when the reader asks.
export const VALIDATE_MEMORY_QUERY = /* GraphQL */ `
  query ValidateMemory($memoryRef: ID!, $limit: Int) {
    validateMemory(memoryRef: $memoryRef, limit: $limit) {
      nodesChecked
      totalFindings
      totalInformational
      truncated
      findings { kind nodeId nodeLoc nodeUrn detail }
      skippedChecks { check reason }
    }
  }
`;

export const RETRY_FAILED_EMBEDDINGS_MUTATION = /* GraphQL */ `
  mutation RetryFailedEmbeddings($memoryRef: ID!) { retryFailedEmbeddings(memoryRef: $memoryRef) }
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
      # #914: the revision this snapshots; null on legacy rows.
      revNo
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
      # #1171 (server #1610): the Worker and Agent behind the edit; null on
      # revisions captured before #1610 or with no agent behind them.
      editedByWorker { id name urn }
      editedByAgent { id name urn }
      revLabel
      # #620: which node fields the edit changed (empty on legacy rows).
      changes
      createdAt
    }
  }
`;

// portal#1355 (server#2562, #2517): the audit entries a HARD delete left on
// this node when it removed edges the node held to the deleted target
// (hrn:node:hadronmemory.com:specs:cor:dmo:010:04). A separate record from NodeRevision — revisions stay
// snapshots of the node's own fields — read through the same gate as
// nodeRevisions. edgeLoc/targetLoc come back null when the deleted target's
// memory is not one the viewer can read.
export const NODE_EDGE_REMOVALS_QUERY = /* GraphQL */ `
  query NodeEdgeRemovals($nodeRef: ID!, $limit: Int) {
    nodeEdgeRemovals(nodeRef: $nodeRef, limit: $limit) {
      id
      edgeLoc
      edgeName
      targetId
      targetLoc
      reason
      removedBy
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
      revNo
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
      # #1171 (server #1610): the Worker and Agent behind the edit; null on
      # revisions captured before #1610 or with no agent behind them.
      editedByWorker { id name urn }
      editedByAgent { id name urn }
      revLabel
      changes
      createdAt
    }
  }
`;

// #914 (server #1326): authorship + advisory content validation. Each is read
// by its OWN query, never folded into the node, History or revision reads:
// `contentValidation` is NON-NULL, so a resolver error there would null the
// parent node (or the whole revision list) and take the surface down with it.
// Apart, a failure costs only this display, which then says "couldn't load".
// `authorship` also reconciles the node's revision server-side, which is one
// more reason to keep it off every read that doesn't render it.
const PROVENANCE_FIELDS = /* GraphQL */ `
  fragment NodeAuthorshipFields on NodeAuthorship {
    kind
    taskRef
    taskRevision
    human { handle urn }
    authoredAt
  }
  fragment NodeContentValidationFields on NodeContentValidationStatus {
    state
    latestReport {
      nodeRevision
      validationTaskRef
      validationTaskRevision
      outcome
      reportedAt
    }
  }
`;

export const NODE_PROVENANCE_QUERY = /* GraphQL */ `
  ${PROVENANCE_FIELDS}
  query NodeProvenance($ref: ID!) {
    node(ref: $ref) {
      id
      # The revision these stamps describe: the loader shows them only when it
      # equals the revision the page rendered (bindToRevision).
      revision
      authorship { ...NodeAuthorshipFields }
      contentValidation { ...NodeContentValidationFields }
    }
  }
`;

// Same `limit` as NODE_REVISIONS_QUERY, so every History row has its provenance.
export const NODE_REVISIONS_PROVENANCE_QUERY = /* GraphQL */ `
  ${PROVENANCE_FIELDS}
  query NodeRevisionsProvenance($nodeRef: ID!, $limit: Int) {
    nodeRevisions(nodeRef: $nodeRef, limit: $limit) {
      id
      revNo
      authorship { ...NodeAuthorshipFields }
      contentValidation { ...NodeContentValidationFields }
    }
  }
`;

// #1001: the live content a revision's diff ends at, when that revision is the
// newest snapshot. raw: true — the text as authored, never template-compiled.
export const NODE_LIVE_CONTENT_QUERY = /* GraphQL */ `
  query NodeLiveContent($ref: ID!) {
    node(ref: $ref, raw: true) { id content revision }
  }
`;

export const NODE_REVISION_PROVENANCE_QUERY = /* GraphQL */ `
  ${PROVENANCE_FIELDS}
  query NodeRevisionProvenance($revisionId: ID!) {
    nodeRevision(revisionId: $revisionId) {
      id
      revNo
      authorship { ...NodeAuthorshipFields }
      contentValidation { ...NodeContentValidationFields }
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
  mutation CreateAgent($orgId: ID!, $name: String!, $description: String, $systemMemoryId: String, $visibility: AgentVisibility) {
    createAgent(orgId: $orgId, name: $name, description: $description, systemMemoryId: $systemMemoryId, visibility: $visibility) { ...AgentFields }
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

// #636: single-agent find-one (full fields) by id/URN. `agent(ref:)` is
// membership-gated for org agents, owner-gated for user-owned (org-less) agents,
// and admits PUBLIC agents — so the detail page can resolve BOTH org and
// user-owned agents through one owner-accessible path (replacing the old
// organizations()-scan that only found org agents).
// #1335: clonedFromAgentRef is selected HERE and not in AGENT_FIELDS, which the
// list and mutation documents spread, so only the detail page asks for it.
export const AGENT_QUERY = /* GraphQL */ `
  ${AGENT_FIELDS}
  query Agent($ref: ID!) {
    agent(ref: $ref) { ...AgentFields clonedFromAgentRef }
  }
`;

// #1262 — S1 cloneAgent: the new Agent's identity only. The origin
// (clonedFromAgentRef) is read by the detail query above (#1335), never here.
export const CLONE_AGENT_MUTATION = /* GraphQL */ `
  mutation CloneAgent($source: ID!, $target: ID!, $name: String, $slug: String) {
    cloneAgent(source: $source, target: $target, name: $name, slug: $slug) {
      id urn name organizationId visibility
    }
  }
`;

export const UPDATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgent($ref: ID!, $name: String, $urn: String, $description: String, $systemMemoryId: String, $visibility: AgentVisibility, $personaRole: String) {
    updateAgent(ref: $ref, name: $name, urn: $urn, description: $description, systemMemoryId: $systemMemoryId, visibility: $visibility, personaRole: $personaRole) { ...AgentFields }
  }
`;

// #942: the defaults an install-created register row starts with (spec 049
// Phase 5). Kept out of AgentFields so the many routes sharing that fragment
// don't select a field they never render; only the agent Settings tab reads it.
export const AGENT_REGISTER_DEFAULTS_QUERY = /* GraphQL */ `
  query AgentRegisterDefaults($ref: ID!) {
    agent(ref: $ref) { id registerDefaults { mentionOnly } }
  }
`;

// Sends ONLY registerDefaults, so saving it can't touch any other agent setting.
export const UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION = /* GraphQL */ `
  mutation UpdateAgentRegisterDefaults($ref: ID!, $registerDefaults: RegisterDefaultsInput!) {
    updateAgent(ref: $ref, registerDefaults: $registerDefaults) { id registerDefaults { mentionOnly } }
  }
`;

// portal#1405 (R211): replaces the roles the Agent offers and nothing else in its
// installation policy. Existing members keep their role (server-side, by design).
export const UPDATE_AGENT_MEMBER_ROLES_MUTATION = /* GraphQL */ `
  mutation UpdateAgentMemberRoles($ref: ID!, $memberRoles: [String!]!) {
    updateAgent(ref: $ref, memberRoles: $memberRoles) { id installationPolicy { memberRoles } }
  }
`;

export const DELETE_AGENT_MUTATION = /* GraphQL */ `
  mutation DeleteAgent($ref: ID!) { deleteAgent(ref: $ref) }
`;

export const ADD_MEMORY_TO_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation AddMemoryToAgent($agentRef: ID!, $memoryRef: ID!, $role: String) {
    addMemoryToAgent(agentRef: $agentRef, memoryRef: $memoryRef, role: $role) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MEMORY_ROLE_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgentMemoryRole($agentRef: ID!, $memoryRef: ID!, $role: String!) {
    updateAgentMemoryRole(agentRef: $agentRef, memoryRef: $memoryRef, role: $role) { ...AgentFields }
  }
`;

export const REMOVE_MEMORY_FROM_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation RemoveMemoryFromAgent($agentRef: ID!, $memoryRef: ID!) {
    removeMemoryFromAgent(agentRef: $agentRef, memoryRef: $memoryRef) { ...AgentFields }
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
    $orgRef: ID!, $agentRef: ID!, $name: String!, $urn: String,
    $appType: AppType, $role: AppMembershipRole,
    $description: String,
    $surfaces: [String!],
    $createUserPermission: CreateUserPermission,
    $identifyUserMethod: IdentifyUserMethod,
    $sessionTimeoutSeconds: Int, $anonymousTtlDays: Int
  ) {
    createApp(
      orgRef: $orgRef, agentRef: $agentRef, name: $name, urn: $urn,
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

// #648: org-less (personal) app create — createApp with NO orgId → user-owned
// App (ownerUserId = caller, organizationId NULL, spec 047), installing a PUBLIC
// or the caller's OWN personal agent. Deliberately OMITS the orgId variable (an
// empty-string orgId is rejected server-side; absence is the personal-create
// signal). Mirrors CREATE_PERSONAL_AGENT_MUTATION. `urn` is the slug — the server
// namespaces it under the caller's handle.
export const CREATE_PERSONAL_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation CreatePersonalApp(
    $agentRef: ID!, $name: String!, $urn: String,
    $appType: AppType, $surfaces: [String!]
  ) {
    createApp(
      agentRef: $agentRef, name: $name, urn: $urn,
      appType: $appType, surfaces: $surfaces
    ) {
      ...AppFields
    }
  }
`;

export const UPDATE_APP_MUTATION = /* GraphQL */ `
  ${APP_FIELDS}
  mutation UpdateApp(
    $ref: ID!, $name: String, $urn: String, $appType: AppType,
    $role: AppMembershipRole,
    $description: String, $agentTools: [String!],
    $aiProvider: String, $aiModel: String, $aiApiKey: String,
    $expiresAt: String,
    $createUserPermission: CreateUserPermission,
    $identifyUserMethod: IdentifyUserMethod,
    $sessionTimeoutSeconds: Int, $anonymousTtlDays: Int
  ) {
    updateApp(
      ref: $ref, name: $name, urn: $urn, appType: $appType, role: $role,
      description: $description
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

// ---------------------------------------------------------------------------
// App Keys
// ---------------------------------------------------------------------------

// An argument and its $variable share a name — `appKeys(appRef: $appRef)`.
// `pnpm gql:validate` checks that, and cross-checks the keys every caller
// passes, so a mismatch is a build error rather than a convention to remember.
/**
 * portal#1153 (hadron-server#2109): `App.viewerManages`, in its OWN request. A
 * server that predates the field answers with a hard GraphQL error, and on the
 * shared App fragment that would take down every App surface; here the loader
 * classifies it as unknown and the key controls render as before.
 */
export const APP_VIEWER_MANAGES_QUERY = /* GraphQL */ `
  query AppViewerManages($ref: ID!) {
    app(ref: $ref) { id viewerManages }
  }
`;

export const APP_KEYS_QUERY = /* GraphQL */ `
  query AppKeys($appRef: ID!) {
    appKeys(appRef: $appRef) {
      id label keyPreview lastUsedAt createdAt revokedAt
    }
  }
`;

export const CREATE_APP_KEY_MUTATION = /* GraphQL */ `
  mutation CreateAppKey($appRef: ID!, $label: String) {
    createAppKey(appRef: $appRef, label: $label) {
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
  mutation DeleteApp($ref: ID!) { deleteApp(ref: $ref) }
`;

// #802 — an App holds MANY agents, through the AppAgent join.
//
// These used to call `addAgentToApp` / `removeAgentFromApp`, which the server
// deprecated in spec 023-app-shape US1, and the comment here described them as
// setters on `App.agent_id`. That model is gone: 023-app-shape Phase 2b moved
// App-to-Agent off the scalar column and onto the `AppAgent` join, so the old
// comment invited the next reader to treat a column that is no longer the
// source of truth as one. Behaviour was never wrong — `addAgentToApp` delegates
// to the same `installAgentIntoAppCore` — so this is a rename plus an honest
// comment, not a fix.
//
// The selection sets are deliberately minimal. Both call sites DISCARD the
// result (the form action returns a success message and the page reloads), and
// the deprecated pair returned `...AppFields` — a whole App fragment fetched,
// serialized and thrown away on every link/unlink. Asking for a couple of
// scalars instead is the rendered-subfields rule applied to a rendered set of
// nothing — see
// `hrn:node:hadronmemory.com:hadron-portal:review:graphql-fetch-rendered-subfields`.
//
// SCALARS specifically, not `appAgent { agent { id } }` (@copilot): a nested
// object field makes the server resolve the Agent to answer a question nobody
// asked. `createdAt` is the install timestamp on the join row itself, so it
// needs no extra load — and a payload type must be given at least one field, so
// "select nothing" is not available.
export const INSTALL_AGENT_INTO_APP_MUTATION = /* GraphQL */ `
  mutation InstallAgentIntoApp($appRef: ID!, $agentRef: ID!, $trainingMode: Boolean) {
    installAgentIntoApp(appRef: $appRef, agentRef: $agentRef, trainingMode: $trainingMode) {
      appAgent {
        createdAt
      }
    }
  }
`;

export const UNINSTALL_AGENT_FROM_APP_MUTATION = /* GraphQL */ `
  mutation UninstallAgentFromApp($appRef: ID!, $agentRef: ID!) {
    uninstallAgentFromApp(appRef: $appRef, agentRef: $agentRef) {
      agentId
      appId
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
    endpoint
    effectiveEndpoint
    apiStyle
    effectiveApiStyle
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
    $provider: String!, $model: String!, $apiKey: String, $params: JSON, $enabled: Boolean,
    $endpoint: String, $apiStyle: AiApiStyle
  ) {
    createAiServiceConfig(
      ownerType: $ownerType, ownerId: $ownerId, name: $name,
      provider: $provider, model: $model, apiKey: $apiKey, params: $params, enabled: $enabled,
      endpoint: $endpoint, apiStyle: $apiStyle
    ) {
      ...AiServiceConfigFields
    }
  }
`;

export const UPDATE_AI_SERVICE_CONFIG_MUTATION = /* GraphQL */ `
  ${AI_SERVICE_CONFIG_FIELDS}
  mutation UpdateAiServiceConfig(
    $id: ID!, $name: String, $provider: String, $model: String,
    $apiKey: String, $params: JSON, $enabled: Boolean,
    $endpoint: String, $apiStyle: AiApiStyle
  ) {
    updateAiServiceConfig(
      id: $id, name: $name, provider: $provider, model: $model,
      apiKey: $apiKey, params: $params, enabled: $enabled,
      endpoint: $endpoint, apiStyle: $apiStyle
    ) {
      ...AiServiceConfigFields
    }
  }
`;

/**
 * server#1373: the known endpoints for a provider, from the server's single
 * suggestion list. The default is marked; `note` says what the URL doesn't
 * (for Z.ai, which plan it bills).
 */
export const AI_PROVIDER_ENDPOINTS_QUERY = /* GraphQL */ `
  query AiProviderEndpoints($provider: String!) {
    aiProviderEndpoints(provider: $provider) { url label isDefault note }
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
      # #1373: where a request for this config is meant to go. The portal
      # runtime refuses a config whose endpoint isn't a host it calls
      # (portalRuntimeRefusal) rather than run it elsewhere with its key.
      effectiveEndpoint
    }
  }
`;

// #928: the Agent tester's readiness probe. The SAME resolution the tester's
// runtime performs (fetchAgentAIConfig: name default, agentRef, no app), so
// the two cannot disagree: inherited Agent -> Org -> Host configs count, a
// nearer enabled config without a key fails closed, and the server alone
// decides what makes a config usable. Deliberately selects NO key material:
// the decrypted key stays on the server, and nothing here can leak it to the
// page. Same gate as the runtime (org ADMIN of the effective org).
export const AI_CONFIG_READINESS_QUERY = /* GraphQL */ `
  query AiConfigReadiness($name: String, $agentRef: ID) {
    resolveAIConfig(name: $name, agentRef: $agentRef) {
      name
      ownerType
      provider
      model
      # #958: the runtime also refuses a config by where it sends requests
      # (portalRuntimeRefusal), so readiness asks the same question.
      effectiveEndpoint
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

// `seq` is selected because it is the CURSOR, not because anything renders it:
// `beforeSeq` (hadron-server#1116) pages backward from the oldest seq the client
// holds. Dropping it from this selection set would silently end the scrollback
// at the first page — the read would still succeed, which is what makes it worth
// saying here.
export const CHAT_HISTORY_QUERY = /* GraphQL */ `
  query ChatHistory($chatId: String!, $limit: Int, $beforeSeq: Int) {
    chatHistory(chatId: $chatId, limit: $limit, beforeSeq: $beforeSeq) {
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
    $sourceRef: ID!
    $targetRef: ID!
    $name: String
    $condition: JSON
    $priority: Int
    $data: JSON
  ) {
    createEdge(
      sourceRef: $sourceRef
      targetRef: $targetRef
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
    $edgeRef: ID!
    $name: String
    $description: String
    $isRunnable: Boolean
    $condition: JSON
    $priority: Int
    $data: JSON
  ) {
    updateEdge(
      edgeRef: $edgeRef
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
// #656 (server #783): Edge.source / Edge.target are NULLABLE — an endpoint in a
// memory the caller can't read comes back null (a cross-memory edge's far end,
// typically via incomingEdges). Every consumer must treat a null endpoint as an
// opaque "private" endpoint rather than dereferencing .name / .loc / .memory.
export const EDGE_HOST_NODE_QUERY = /* GraphQL */ `
  query EdgeHostNode($ref: ID!) {
    node(ref: $ref) {
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
  query FlowUpstreamNode($ref: ID!) {
    node(ref: $ref) {
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
  mutation DeleteEdge($edgeRef: ID!) {
    deleteEdge(edgeRef: $edgeRef)
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

// The CALLER's worker sessions for one worker (#737) — for the worker page.
//
// SCOPE, and it is not what the name suggests. `sessions` returns "sessions
// recorded against the CALLER" (its own schema description), and workerRef only
// narrows that caller-scoped set. So this reads "the stints I drove as this
// worker", NOT the worker's history: a worker driven entirely by a teammate
// comes back EMPTY here rather than returning their sessions.
//
// The page must therefore never make an absolute claim from this data. #737
// assumed otherwise — "sessions(workerRef:) accepts the worker and filters
// server-side" — and the schema's own note says that filter exists for the
// "taken right now / last driven by" read, which is a question about your own
// binding rather than a history read. Caught by Codex on #752.
//
// Note the asymmetry with the worklog rendered directly beneath it:
// teamWorkItems(workerRef:) IS App-scoped, so it returns EVERY driver's records
// for this worker. A reader seeing a populated worklog beside an empty session
// list would otherwise conclude something false, which is why the section says
// whose sessions it is showing.
//
// Deliberately does NOT select `worker { ... }`: this page already knows whose
// sessions these are, and Session.worker runs a WIDER read gate than the worker
// query itself. Selecting working-state through it (heldByUserId, memoryId,
// prompt) would let a former App member read current staffing off a
// historical session. Keep this selection worker-free.
//
// `sessions` returns a BARE [Session!]! — no page envelope and no total, unlike
// teamWorkItems. So paging observes a short page rather than counting: fetch
// limit+1 and slice, the same trick the org sessions list uses.
//
// expiresAt and autoExpiredAt are selected on purpose. They are on the wire and
// unselected by every client today, which is why four worker sessions expired
// in four days and each was discovered only by a failed write. autoExpiredAt
// separates a REAP from a deliberate close; expiresAt is the only forward-
// looking signal either surface has (hadron-cli#484).
export const WORKER_SESSIONS_QUERY = /* GraphQL */ `
  query WorkerSessions($workerRef: String!, $limit: Int, $offset: Int) {
    sessions(workerRef: $workerRef, limit: $limit, offset: $offset) {
      id
      type
      repo
      branch
      tool
      host
      llmModel
      plan
      summary
      prNumber
      turnCount
      errorCount
      startedAt
      endedAt
      expiresAt
      autoExpiredAt
      # Host-local and meaningless to anyone not on that machine — rendered as
      # plain text, NEVER as a link (#737).
      transcriptPath
    }
  }
`;

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
      # hadron-server#980: who did the work, nested so the list renders the
      # app-qualified compound ('eng-team/Iris') without a per-row round trip.
      # A session list is org-wide, so the bare name is NOT sufficient there
      # (hrn:node:hadronmemory.com:specs:cor:agt:020:02) — hence app.urn, whose slug is the qualifier.
      #
      # retiredAt is selected because retirement ends the casting, not the
      # history: past sessions stay attributed, and the row should say so
      # rather than presenting a retired worker as current staff.
      #
      # worker.app runs its OWN read gate and masks to null on deny (#552), so
      # it is nullable independently of the worker itself — see the Worker
      # column's degradation note. (No backticks in this template literal:
      # a backtick here terminates the tagged string.)
      worker {
        id
        name
        retiredAt
        app { id urn }
      }
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
    # appId: the App an app-class memory pivots on — the appRef App-scoped
    # platform operations take (team-chat posting reads it off the node).
    memory { id urn name appId }
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
    # #868 (server #1201): role and isRunnable are the two GOVERNANCE SIGNALS,
    # and they are selected here — on the shared fragment — because every
    # node-write call site needs the node's CURRENT kind to pick its door. Six
    # of the nine never touch either signal, so their resulting kind IS the
    # current one; a call site that cannot see these two fields cannot route,
    # and routing it through the generic door is what #868 is.
    # Not rendered anywhere today. See $lib/server/nodeKindDoor.ts.
    # (No backticks in this comment: the file is a template literal and one
    # inside a GraphQL # comment ends it — collectCommentTerminated catches it.)
    role
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

// Unified node search (hrn:node:hadronmemory.com:specs:cor:api:090). `findNodes` supersedes `nodes` + `nodeSearch`;
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
// #1202: fixtures are system nodes, independently of the memory's class.
// Keep this narrow read separate from GraphNodes' mixed-type default.
export const FIXTURE_NODES_QUERY = /* GraphQL */ `
  query FixtureNodes($limit: Int, $offset: Int, $memoryIds: [ID!]!) {
    findNodes(filter: { memoryIds: $memoryIds, nodeType: "system" }, limit: $limit, offset: $offset) {
      hits { node { id loc memoryId data } }
    }
  }
`;

export const GRAPH_NODES_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query GraphNodes($limit: Int, $offset: Int, $memoryIds: [ID!]) {
    findNodes(filter: { memoryIds: $memoryIds }, limit: $limit, offset: $offset) {
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
      # openThreads: portal#1014 (hadron-server#1663), the node list's
      # open-feedback cue (hrn:node:hadronmemory.com:specs:cor:dmo:110:07); batched server-side.
      nodes { id loc name nodeType tags seq isRunnable description openThreads }
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

// Team chat (server #939): posting is a PLATFORM operation, never a hand-rolled
// node write. The resolver allocates the message's `seq` atomically under the
// chat-root lock and updates the root's messageCount/lastMessageAt; a portal-side
// createNode would land an off-road node the platform readers ignore. `appRef` is
// the App the chat belongs to — a team chat lives in that App's shared app-class
// memory, so `Memory.appId` supplies it.
// replyToSeq is optional and wires a replies-to edge server-side; it is
// validated inside the allocating transaction, so a failed reply consumes no
// seq. Callers with no reply target simply omit the variable.
export const CREATE_TEAM_CHAT_MESSAGE_MUTATION = /* GraphQL */ `
  mutation CreateTeamChatMessage($appRef: ID!, $body: String!, $replyToSeq: Int) {
    createTeamChatMessage(appRef: $appRef, body: $body, replyToSeq: $replyToSeq) {
      nodeId
      seq
      body
      at
      authorName
    }
  }
`;

// The team chat transcript, read through the CANONICAL operation rather than by
// walking nodes (hadron-portal#732). Two reasons this matters beyond tidiness:
//
//   - The App's shared app-class memory is unreachable from appNodes
//     (hadron-server#1031), so a node-walking reader could not see this chat at
//     all. Reading through the operation keeps that issue off this surface.
//   - The operation returns the ENVELOPE. authorWorkerId vs authorUserId is the
//     worker/human discriminator that node content alone cannot express, and it
//     is the whole point of the surface: a reader must be able to tell a
//     teammate's post from a human's at a glance.
//
// mentions are extracted server-side at write time. Clients never re-parse
// bodies, so this selection is the only supported source for them.
export const TEAM_CHAT_MESSAGES_QUERY = /* GraphQL */ `
  # #793: beforeSeq (server #1116) is the BACKWARD mirror of sinceSeq — only
  # messages with seq strictly less than it are considered, and the NEWEST of
  # those are returned. The server IGNORES offset when beforeSeq is given, which
  # is the point: an offset is an index into a list whose length changes under a
  # reader while workers post, so it skips or duplicates mid-scroll. seq is
  # atomic and unique per chat, so the cursor is stable.
  #
  # #1137: teamHeadRef / untagged are the S3 team filter (server#2019),
  # mutually exclusive and applied SERVER-SIDE before paging and total. Both
  # are omitted for the unfiltered thread. teamTags is the stored head
  # identity per message — headId is the identity, label display only.
  query TeamChatMessages(
    $appRef: ID!
    $sinceSeq: Int
    $beforeSeq: Int
    $limit: Int
    $offset: Int
    $teamHeadRef: ID
    $untagged: Boolean
  ) {
    teamChatMessages(
      appRef: $appRef
      sinceSeq: $sinceSeq
      beforeSeq: $beforeSeq
      limit: $limit
      offset: $offset
      teamHeadRef: $teamHeadRef
      untagged: $untagged
    ) {
      items {
        nodeId
        seq
        body
        at
        authorUserId
        authorWorkerId
        authorName
        sessionId
        replyToSeq
        mentions
        # #855 / server#1209: the message node's canonical URN, composed
        # server-side since a message loc carries a random component. Null
        # when it cannot be emitted in grammar v2; the thread then shows no
        # message chip.
        urn
        teamTags {
          headId
          label
        }
      }
      total
    }
  }
`;

// Team-chat history search (#1013, server#2299). The page carries REFERENCES only
// (no text): a hit is read back through `CHANNEL_HIT_MESSAGE_QUERY` below.
export const TEAM_CHAT_SEARCH_QUERY = /* GraphQL */ `
  query TeamChatSearch($appRef: ID!, $query: String!, $cursor: String, $limit: Int) {
    teamChatSearch(appRef: $appRef, query: $query, cursor: $cursor, limit: $limit) {
      items {
        nodeId
        urn
        seq
        channelId
        channelIncarnation
      }
      complete
      cursor
      channelId
      channelIncarnation
    }
  }
`;

// One hit's message, read through the existing channel read path. `sinceSeq` is
// EXCLUSIVE, so `seq - 1` with limit 1 lands on the hit. The read is pinned to the
// incarnation the search saw (a changed one is CHANNEL_INCARNATION_CHANGED, never a
// retarget) and `advanceReadState: false` keeps opening a hit from acknowledging a
// range the reader has not seen.
export const CHANNEL_HIT_MESSAGE_QUERY = /* GraphQL */ `
  query ChannelHitMessage($channelRef: ID!, $sinceSeq: Int!, $expectedIncarnation: Int!) {
    channelMessages(
      channelRef: $channelRef
      sinceSeq: $sinceSeq
      limit: 1
      expectedIncarnation: $expectedIncarnation
      advanceReadState: false
    ) {
      items {
        nodeId
        seq
        body
        at
        authorName
        urn
      }
    }
  }
`;

// The team worklog (#947) — the AUTHORITATIVE artifact-to-session join
// (hrn:node:hadronmemory.com:specs:cor:agt:020:05), which is what lets a merged PR trace back to the worker and
// transcript that produced it.
//
// Read via this operation, never by walking nodes: the records live in the
// App's class='app' shared memory, which appNodes cannot reach
// (hadron-server#1031). Filtering and paging are server-side, so the portal
// never scans.
//
// `ref` is matched TOOL-AWARELY server-side: with github (or no tool) the
// spelling is normalized, so a pasted PR URL and the short form find the same
// records. That normalization is exactly why ref lookup belongs on the server
// rather than as a client-side string compare.
//
// `detail` is display extras (title, URL) and is documented as never
// filterable — it is rendered, not searched.
export const TEAM_WORK_ITEMS_QUERY = /* GraphQL */ `
  query TeamWorkItems(
    $appRef: ID!
    $ref: String
    $kind: String
    $tool: String
    $workerRef: ID
    $limit: Int
    $offset: Int
  ) {
    teamWorkItems(
      appRef: $appRef
      ref: $ref
      kind: $kind
      tool: $tool
      # hadron-server#1035 — everything ONE worker has done, filtered
      # server-side so the page envelope stays correct. Omitted by the App-level
      # worklog tab, which wants the whole team; supplied by the worker page.
      #
      # The alternative was a fan-out over sessions(workerRef:) plus a
      # client-side merge, which cannot reproduce total or a stable offset on
      # the one surface whose whole point is completeness. That interim was
      # explicitly ruled out rather than merely avoided.
      #
      # A ref naming nothing readable in this App yields an EMPTY page, never an
      # error — so this is not an existence oracle for another App's roster, and
      # an empty result must not be reported as a failure.
      workerRef: $workerRef
      limit: $limit
      offset: $offset
    ) {
      items {
        nodeId
        sessionId
        workerName
        workerId
        tool
        kind
        ref
        action
        at
        detail
        # hadron-server#1398: the LLM model snapshotted at record time. Null =
        # unknown (predates the field, or none was reported). Never backfilled.
        model
      }
      total
    }
  }
`;

// Full nodes under a loc subtree (memoryId + loc prefix). Used where a caller
// needs the heavy fields (content/data/createdAt) that the slim memoryNodes
// projection omits — e.g. team-chat messages under `<chat>:messages:`, which
// #447 stopped shipping via the memory layout's graphNodes. `locPrefix` maps to
// a `loc startsWith` match server-side (resolvers.query.node).
// #744 — the App's chat ROOTS, for the Chats tab's selector.
//
// nodeType 'chat' is the root; its messages hang under <loc>:messages: as
// 'chat-message' nodes and are NOT wanted here. The filter is pushed
// server-side, so the selector does not page through an App's whole node set
// to find two chats.
//
// This only became possible with hadron-server#1066: appNodes builds its scope
// from the installed agents' memories, and the App's team space — where the
// team chat and the 1:1 chats actually live — was structurally unreachable, with
// filter.memoryIds rejected so there was no way to opt in. That is why the 1:1
// chat in #744 could not be reached from anywhere in the portal, including the
// Memory tab.
export const APP_CHAT_ROOTS_QUERY = /* GraphQL */ `
  query AppChatRoots($appRef: ID!, $limit: Int) {
    appNodes(appRef: $appRef, filter: { nodeType: "chat" }, limit: $limit) {
      id
      loc
      name
      memoryId
      nodeType
    }
  }
`;

// portal#1524: the node page's Children section, now that the memory layout no
// longer carries the whole node list. ONE bounded, slim page of the nodes under
// a loc: only the fields the children grid renders, no content, and `total` so
// the caller can tell a complete page from a truncated one (a truncated page
// cannot prove which direct children exist, so the section is withheld rather
// than shown short).
export const NODE_CHILDREN_QUERY = /* GraphQL */ `
  query NodeChildren($memoryId: ID!, $locPrefix: String!, $limit: Int) {
    findNodes(filter: { memoryIds: [$memoryId], locPrefix: $locPrefix }, limit: $limit, sort: seq) {
      total
      hits { node { id loc name description nodeType tags seq isRunnable memoryId commentSummary { openThreads } } }
    }
  }
`;

export const NODES_BY_LOC_PREFIX_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query NodesByLocPrefix(
    $memoryId: ID!
    $locPrefix: String!
    $limit: Int
    $offset: Int
    $sort: NodeSort
  ) {
    findNodes(
      filter: { memoryIds: [$memoryId], locPrefix: $locPrefix }
      limit: $limit
      offset: $offset
      sort: $sort
    ) {
      # #793: total is what makes a TAIL window addressable. The server pages
      # from the start, so "the newest N" is offset = total - N; without the
      # count there is no way to ask for the end of a thread, which is the only
      # part a chat reader wants first.
      total
      hits { node { ...NodeFields } }
    }
  }
`;

// #926: the evidence probe for a tag-only (legacy) chat root. Slim on purpose:
// only the legacy MESSAGE nodes under the root's messages prefix, and only the
// fields the direct-child check reads. Sorted by loc so direct children come
// before their own descendants.
export const LEGACY_THREAD_PROBE_QUERY = /* GraphQL */ `
  query LegacyThreadProbe($memoryId: ID!, $locPrefix: String!, $limit: Int) {
    findNodes(
      filter: { memoryIds: [$memoryId], locPrefix: $locPrefix, nodeType: "message" }
      limit: $limit
      sort: loc
    ) {
      total
      hits { node { loc nodeType } }
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
// (hrn:node:hadronmemory.com:specs:cor:api:090). #429.
// portal#1174: the Nodes tab's extra columns for a set of nodes, through the
// server's batched `nodeBatch` (cap 200 refs) so each batch is one call. Only
// the six facts the table shows, never content. Kept OUT of the shared layout
// payload and the slim `memoryNodes` rows on purpose
// (hrn:node:hadronmemory.com:hadron-portal:review:shared-layout-payload-consumers):
// the tab reads them lazily, per batch, after the list is on screen.
export const NODE_COLUMNS_QUERY = /* GraphQL */ `
  query NodeColumns($refs: [ID!]) {
    nodeBatch(refs: $refs) {
      nodes {
        id
        role
        updatedAt
        revision
        approvalStatus { state }
        signatureStatus { state }
        embeddingPendingAt
        embeddingFailedAt
        embeddingError
        # Last authored-edit attribution; the user projection landed in #2189.
        updatedByUser { handle urn }
        updatedByAgent { id name urn }
        updatedByWorker { id name urn }
      }
      unavailable
      omitted
      truncated
    }
  }
`;

// The same read without signatureStatus. That field exists only while the
// server has signing on (hadron-server#1918: while off it is removed from the
// schema, so selecting it fails the WHOLE query), and the portal asks the
// deployment first (`deploymentOffersSigning`, portal#1022). One hidden field
// must not sink Role, Last changed, Revision and Approved with it (Celine on
// #1181).
export const NODE_COLUMNS_NO_SIGNING_QUERY = /* GraphQL */ `
  query NodeColumnsNoSigning($refs: [ID!]) {
    nodeBatch(refs: $refs) {
      nodes {
        id
        role
        updatedAt
        revision
        approvalStatus { state }
        embeddingPendingAt
        embeddingFailedAt
        embeddingError
        updatedByUser { handle urn }
        updatedByAgent { id name urn }
        updatedByWorker { id name urn }
      }
      unavailable
      omitted
      truncated
    }
  }
`;

// portal#1433: a node page's breadcrumb needs the id and name of each ANCESTOR
// of one loc, which used to be a map lookup over the layout's whole node list.
// One `nodeBatch` of the ancestors' node URNs (at most loc-depth refs; cap 200)
// replaces it. `unavailable` echoes refs the viewer cannot read or that do not
// exist; the crumb then keeps that segment's slug, as it always did. `nodeType`
// and `tags` ride along because the chat-message page classifies its chat root,
// which is one of these ancestors, with them.
// Raw by contract: `nodeBatch` never compiles Mustache content (its schema
// doc: "Node content is returned raw"), so these metadata reads need no
// `raw: true` like the single `node(ref:)` read in wikilinks.ts (#684). That
// keeps the per-page-load ancestor read free of template evaluation (#1438
// BLIND P2).
export const NODE_ANCESTORS_QUERY = /* GraphQL */ `
  query NodeAncestors($refs: [ID!]) {
    nodeBatch(refs: $refs) {
      nodes { id loc name nodeType tags memoryId }
      unavailable
      omitted
      truncated
    }
  }
`;

// portal#1433: a node page's same-memory `[[loc]]` wikilink targets, which
// used to resolve against the layout's whole node list. One `nodeBatch` of
// their node URNs (cap 200); a target absent from `nodes` is not in this
// memory, or not readable by the viewer — unless the answer was truncated
// (see `lookupLocal`).
// Raw by contract: `nodeBatch` never compiles Mustache content (its schema
// doc: "Node content is returned raw"), so these metadata reads need no
// `raw: true` like the single `node(ref:)` read in wikilinks.ts (#684). That
// keeps the per-page-load ancestor read free of template evaluation (#1438
// BLIND P2).
export const WIKILINK_TARGETS_BATCH_QUERY = /* GraphQL */ `
  query WikilinkTargetsBatch($refs: [ID!]) {
    nodeBatch(refs: $refs) {
      nodes { id loc name memoryId }
      unavailable
      omitted
      truncated
    }
  }
`;

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
    $approvalState: NodeApprovalState
    $minted: Boolean
    $contentScope: NodeContentScope
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
      # #433: fields is a lexical scoring weight-mask (hrn:node:hadronmemory.com:specs:cor:api:090:03), not a
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
        # #992 (server #1591): approval and minting state, filtered by the
        # server so no list ever selects Node.approvalStatus per row.
        approvalState: $approvalState
        minted: $minted
        # portal#1015 (server #1608/#1674, hrn:node:hadronmemory.com:specs:cor:dmo:110:08): content, comments or
        # both, applied by the server BEFORE ranking, paging and the result cap.
        # Null is the server default, CONTENT.
        contentScope: $contentScope
      }
    ) {
      hits {
        node {
          ...NodeFields
          # portal#1014 (Jane on #1025): the open-feedback cue must survive a
          # search or filter replacing the list, so result rows carry the count
          # too (hrn:node:hadronmemory.com:specs:cor:dmo:110:07). Batched per request server-side.
          commentSummary { openThreads }
          # portal#1015: this hit AS a comment (null for content), so a
          # Comments or All result renders as feedback with its author, target
          # and anchor revision (hrn:node:hadronmemory.com:specs:cor:dmo:110:08), never as content.
          asComment {
            id
            isTopLevel
            state
            anchorRevision
            deleted
            author {
              kind
              user { id handle name urn }
              agent { id handle name urn }
              worker { id handle name urn }
              app { id handle name urn }
            }
            target { id name nodeType revSeq urn }
          }
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
// portal#1524: the slim "does this node exist, and what is it called" read
// behind /api/nodes/resolve — id, loc and name only, no content.
export const NODE_REF_QUERY = /* GraphQL */ `
  query NodeRef($ref: ID!, $memoryRef: ID!) {
    node(ref: $ref, memoryRef: $memoryRef) {
      id
      loc
      name
    }
  }
`;

export const NODE_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  query Node($ref: ID!, $memoryRef: ID!) {
    node(ref: $ref, memoryRef: $memoryRef, raw: true) {
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
/**
 * #894 — the fresh read behind the Data tab's whole-`data` write: what the
 * action decides on and nothing else. Both governance signals (`role`,
 * `isRunnable`) for the kind door, `tags` for the #235 pass-through, `data`
 * for the stale check. NODE_BY_ID_QUERY would also decrypt and ship the
 * node's content, abstract, edges and asset for a write that touches none.
 */
export const NODE_DATA_READ_QUERY = /* GraphQL */ `
  query NodeDataRead($ref: ID!) {
    node(ref: $ref, raw: true) {
      id
      memoryId
      loc
      isRunnable
      role
      tags
      data
    }
  }
`;

/**
 * #879 / #886 — the fresh read behind a whole-`properties` write (the Task Nodes
 * export checkbox, the node page's Properties Source editor): exactly what
 * those actions decide on, and nothing they do not. `role` and `isRunnable` are the
 * two governance signals `nodeUpdateDocument` routes on, so both MUST be
 * selected (a read without them routes a governed node through the generic
 * door and is refused); `properties` is the bag the write replaces whole.
 * NODE_BY_ID_QUERY would also decrypt and ship the node's content, abstract,
 * edges and asset for a write that touches none of them.
 */
export const NODE_PROPERTIES_READ_QUERY = /* GraphQL */ `
  query NodePropertiesRead($ref: ID!) {
    node(ref: $ref, raw: true) {
      id
      memoryId
      loc
      name
      description
      isRunnable
      role
      properties
    }
  }
`;

/**
 * #911 — just enough of a node to plan its memory: its id, its memoryId and
 * whether it is a task. The single-skill endpoint needs nothing else, so it does not reuse the node
 * page's full read and invoke resolvers it would never render.
 */
export const NODE_MEMORY_REF_QUERY = /* GraphQL */ `
  query NodeMemoryRef($ref: ID!) {
    node(ref: $ref, raw: true) {
      id
      memoryId
      isRunnable
    }
  }
`;

/**
 * #911 — a memory ref (an id or a URN) resolved to its id, and nothing else.
 * Its own document, not a second field on NODE_MEMORY_REF_QUERY: both fields
 * take an argument named ref, and a variable is named after its argument
 * (#681), so one document cannot fill both.
 */
export const MEMORY_REF_ID_QUERY = /* GraphQL */ `
  query MemoryRefId($ref: ID!) {
    memory(ref: $ref) {
      id
    }
  }
`;

/**
 * #911 — the EXPORT plan for ONE selected task, as the single-skill endpoint
 * reads it: only the entry fields that judge one task, plus what the server
 * says about a selected task it will not export.
 *
 * server#1409 (#1406): `selectedSkillFilePlan` plans exactly the named node and
 * judges its name against a COMPLETE collision census, across memories and
 * orgs (`hrn:node:hadronmemory.com:specs:cor:agt:030:06`). The old `skillPlan(memories: [node.memoryId])`
 * judged collisions within that one memory only.
 */
export const SKILL_SELECTED_PLAN_QUERY = /* GraphQL */ `
  query SkillSelectedPlan($host: String!, $nodes: [String!]!) {
    selectedSkillFilePlan(input: { host: $host, nodes: $nodes }) {
      entries {
        nodeId
        name
        class
        renderedBody
        exportPlan {
          action
          reasons {
            code
            message
          }
        }
        findings {
          rule
          severity
          message
        }
      }
      selectionResults {
        ref
        nodeId
        action
        reason {
          code
          message
        }
      }
    }
  }
`;

export const NODE_BY_ID_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  ${ASSET_FIELDS}
  query NodeById($ref: ID!) {
    node(ref: $ref, raw: true) {
      ...NodeFields
      # #257: embedding state is detail-only; do not grow list/search payloads.
      embeddingPendingAt
      embeddingFailedAt
      embeddingError
      # #518: properties is detail-only — kept OUT of the shared NodeFields
      # fragment so it doesn't bloat search/list payloads (NODE_FIND_QUERY
      # spreads the same fragment; PR #523 review, codex).
      properties
      # portal#1175: this node AS a comment — its target (for the breadcrumb
      # link) and whether the viewer wrote it (for the edit controls). Null for
      # content. Detail-only; the search read selects its own, wider asComment.
      asComment {
        id
        deleted
        viewerIsAuthor
        # The comment's write counter: editComment's expectedRevision, which is
        # NOT Node.revision.
        revSeq
        target { id name nodeType urn }
      }
      # #927 (server #1323/#937): the live revision an inline editor opens on
      # and saves against as expectedRevision. Detail-only, like properties.
      revision
      # portal#696 / server#888: the asset a reference node points at (its
      # data.asset), written either by createAssetReferenceNode or by
      # hadron_store_file. NULL for every ordinary node, and ALSO null when the
      # pointer dangles — there is no Asset-to-Node foreign key
      # (hrn:node:hadronmemory.com:specs:cor:dmo:060:10 reserves it), so never assume a node carrying
      # data.asset still has a live asset behind it. Detail-only, for the same
      # reason as properties.
      asset {
        ...AssetFields
      }
      # #489 part 4: the App this node's memory belongs to, for the chat
      # header's App reference. Detail-only and merged onto the memory field
      # here rather than added to NodeFields, for the same reason properties
      # and asset are: that fragment also feeds NODE_FIND_QUERY, so a nested
      # object on it would ride along on every search hit. NodeFields already
      # selects id, urn, name and appId on memory; GraphQL merges this
      # selection onto the same field, so this adds the App and nothing else.
      #
      # appId alone is NOT enough for the reference — a link needs a label a
      # reader recognises and a URN they can paste, and per CLAUDE.md's
      # hrn:node:hadronmemory.com:hadron-portal:review:render-urn a named entity renders its URN alongside. Nullable
      # by contract: most memories have no App.
      #
      # No backticks in this comment: one would end the template literal
      # (#775, hrn:node:hadronmemory.com:hadron-portal:findings:queries-ts-no-backticks-in-graphql-comments). The
      # guard in gql:validate caught exactly that here.
      memory {
        app {
          id
          urn
          name
        }
      }
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

// The TASK KIND DOOR (server #1201/#1203). A runnable node is a governed kind,
// and the generic surface refuses to produce one:
//
//   "This write would produce a RUNNABLE node, which only updateTaskNode may
//    update. Authoring or retiring something the platform will execute is not
//    the same act as writing prose; the generic node surface does not reach it."
//
// It takes the SAME UpdateNodeInput, so routing is a choice of mutation and
// nothing else. Measured: without this the portal cannot save a task node AT
// ALL — the edit page's Runnable checkbox was decorative, and every save on an
// existing task node was refused with the message above, surfaced as a generic
// error on the properties field.
//
// The server decides by the RESULTING kind, not the current one, so the door is
// chosen from the value being submitted.
export const UPDATE_TASK_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpdateTaskNode($input: UpdateNodeInput!) {
    updateTaskNode(input: $input) { ...NodeFields }
  }
`;

// The other two governed kinds (#868). `Node.role` is an OPEN string, and a
// small CLOSED subset of its values is governed the same way `isRunnable` is:
// 'review' (a safety check must not be rewritable through the generic surface)
// and 'spec' (the corpus discipline resting on #1152).
//
// The portal cannot CREATE either kind — it has no `role` field, and whether it
// should gain one is product scope (@Ada on #868, @Holger's call). It can
// absolutely be POINTED AT one the CLI created, and the refusal is then
// identical to the task kind's: every generic write against it is refused,
// whatever it edits. So the UPDATE doors are here and the CREATE doors are not.
//
// Never chosen by hand — `nodeUpdateDocument` in ./nodeKindDoor.ts picks the
// door, and `scripts/check-node-write-doors.mjs` fails a call site that does
// not go through it.
export const UPDATE_REVIEW_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpdateReviewNode($input: UpdateNodeInput!) {
    updateReviewNode(input: $input) { ...NodeFields }
  }
`;

export const UPDATE_SPEC_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpdateSpecNode($input: UpdateNodeInput!) {
    updateSpecNode(input: $input) { ...NodeFields }
  }
`;

// #1159 (server #2175): a soft-deleted node does not resolve through node(ref:).
// recoveryNode is the explicit, writer-only read of the retained tombstone (null
// for anyone who may not recover it, so existence stays hidden), and
// restoreNode brings back that ONE node — never descendants or revisions.
export const RECOVERY_NODE_QUERY = /* GraphQL */ `
  query RecoveryNode($nodeRef: ID!) {
    recoveryNode(nodeRef: $nodeRef) {
      id urn memoryId loc name nodeType description deletedAt content
    }
  }
`;

// #1161: which rows of a list are deleted, as the SERVER reports it (writer-only;
// an unauthorized read throws and the caller marks nothing). Default 20, max 200.
export const RECOVERY_NODES_QUERY = /* GraphQL */ `
  query RecoveryNodes($memoryRef: ID!, $limit: Int, $offset: Int) {
    recoveryNodes(memoryRef: $memoryRef, limit: $limit, offset: $offset) {
      items { id }
      total
    }
  }
`;

// #1161: edges with a deleted endpoint, as the server reports them (writer-only).
export const RECOVERY_EDGES_QUERY = /* GraphQL */ `
  query RecoveryEdges($memoryRef: ID!, $edgeIds: [ID!]!, $limit: Int) {
    recoveryEdges(memoryRef: $memoryRef, edgeIds: $edgeIds, limit: $limit) {
      items {
        id
        name
        source { id urn loc name deletedAt }
        target { id urn loc name deletedAt }
      }
      total
    }
  }
`;

export const RESTORE_NODE_MUTATION = /* GraphQL */ `
  mutation RestoreNode($nodeRef: ID!) {
    restoreNode(nodeRef: $nodeRef) { id }
  }
`;

// hadron-server#542: deleteNode collapsed (loc, memoryId) into a single
// nodeRef (a node PK or fully-qualified URN).
// hard: true permanently removes the row (vs. the default soft-delete's
// deletedAt). #503.
// recursive: true deletes the node plus every descendant under its loc prefix
// (#621) — the server refuses a non-recursive delete of a parent with
// NODE_HAS_DESCENDANTS rather than silently orphaning the subtree.
export const DELETE_NODE_MUTATION = /* GraphQL */ `
  mutation DeleteNode($nodeRef: ID!, $hard: Boolean, $recursive: Boolean) {
    deleteNode(nodeRef: $nodeRef, hard: $hard, recursive: $recursive)
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

// #718 — NODE_USAGE_QUERY was here and had no importers (confirmed in the
// hadron-server#802 caller audit and again for #986). `nodeUsage` is now
// @deprecated in favour of `usageEvents(loc:)`.
//
// If a per-loc usage feed is ever needed here, use `usageEvents(loc: <loc>)`
// and NOT `usageEvents(nodeId: <loc>)` — the latter's shape classification
// misroutes hierarchical locs, which is every spec citation (>=3 colon
// segments). Recorded rather than left to be rediscovered from the issue.

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

// #627/#1176: the caller's OWN org-less memories — the "My memories" list.
//
// `ownedByMe` asks the server the question this list is actually about. It used
// to ask `memoryClasses: [personal, private]` and repair the result in the
// client, and the CLASS FILTER WAS THE DEFECT: class was only ever a proxy for
// ownership, correct while every user-owned memory was personal. Since #653 a
// free-standing `knowledge` memory is org-less and user-owned, so the proxy
// stopped holding and those rows went missing with no error anywhere.
//
// Measured on @Holger's rows: 4 memories he owns, 2 of them listed. The two
// invisible ones (`holger:flow-lab`, `holger:holgers-gear`) are `knowledge`.
//
// Ownership is NOT derivable from the fields the API exposes — `Memory.userId`
// is visible and is the personal/private owner only, while the other classes
// key on `ownerUserId`, which is not in the SDL at all. So a client asks for
// the slice; it must not compute it. That is why the client-side
// `organizationId == null` repair is gone rather than kept as a belt: it was
// correct, and `ownedByMe` is org-less by definition, so keeping it would imply
// the server's answer needed checking.
export const PERSONAL_MEMORIES_QUERY = /* GraphQL */ `
  ${MEMORY_FIELDS}
  query PersonalMemories($limit: Int, $offset: Int) {
    memories(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
      items {
        ...MemoryFields
      }
      total
    }
  }
`;

// #642: a SLIM projection of the caller's owner-only memories — just what a
// picker needs (id/name/urn/class/organizationId/visibility). Avoids pulling the
// heavy MemoryFields fragment (relations, timestamps) when only the list shape
// is needed (Copilot review on #661).
export const PERSONAL_MEMORIES_LITE_QUERY = /* GraphQL */ `
  query PersonalMemoriesLite($limit: Int, $offset: Int) {
    memories(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
      items {
        id
        name
        urn
        class
        organizationId
        visibility
      }
      total
    }
  }
`;

// #778 (server): memories shared WITH the caller (they're a MemoryShare grantee).
// Slim projection — the "Memories shared with me" tab renders id/name/urn/class
// plus `myShare` (who shared it + the caller's role). `myShare` is the caller's
// OWN grantee row (never the owner-only full `shares` list).
export const SHARED_MEMORIES_QUERY = /* GraphQL */ `
  query SharedMemories($limit: Int, $offset: Int) {
    memories(filter: { sharedWithMe: true }, limit: $limit, offset: $offset) {
      items {
        id
        name
        urn
        class
        myShare {
          role
          grantor { id handle name }
        }
      }
      total
    }
  }
`;

// #649: a MemoryShare GRANTEE removes THEIR OWN share ("stop sharing with me" /
// leave). deleteMemoryShare is principal-or-self (hadron-server#785/#786):
// OMITTING granteeRef targets the caller's own grantee row, so no id is needed —
// a non-owner can only ever affect their own share. Idempotent server-side.
export const DELETE_MEMORY_SHARE_MUTATION = /* GraphQL */ `
  mutation DeleteMemoryShare($memoryRef: ID!) {
    deleteMemoryShare(memoryRef: $memoryRef) {
      memoryId
      granteeId
    }
  }
`;

// ---------------------------------------------------------------------------
// #668 — the PRINCIPAL side of memory sharing (spec 023 US3).
//
// The grantee side already existed (#778 `sharedWithMe`, #649 self-removal
// above). These are the owner's half: see who this memory is shared with, grant,
// change a role, revoke.
//
// `shares` is principal / org-admin only — a grantee reading the same memory
// gets `myShare` and nothing else — so a non-owner's request for this query
// does not return a trimmed list, it is refused. The portal hides the tab; the
// server is the gate.
//
// `shareable` (server #766) is the DERIVED signal: true iff this memory can be
// shared with an individual via MemoryShare at all (class = 'personal', spec
// 023 FR-018). Read it rather than re-deriving from `class` here — the class
// list is the server's to change, and a portal copy of it would go stale
// silently and refuse a share the server would have allowed.
export const MEMORY_SHARES_QUERY = /* GraphQL */ `
  query MemoryShares($ref: ID!) {
    memory(ref: $ref) {
      id
      name
      urn
      class
      userId
      shareable
      shares {
        role
        createdAt
        updatedAt
        grantee { id urn handle name email avatarUrl }
        grantor { id urn handle name }
      }
    }
  }
`;

// #668: grant a share. `granteeRef` (server #769) resolves an id, email, handle
// or hrn:user URN server-side, so the picker can pass whatever it has and the
// resolution rules stay in one place.
export const CREATE_MEMORY_SHARE_MUTATION = /* GraphQL */ `
  mutation CreateMemoryShare($memoryId: ID!, $granteeRef: String!, $role: MemoryShareRole!) {
    createMemoryShare(memoryId: $memoryId, granteeRef: $granteeRef, role: $role) {
      memoryShare { role grantee { id handle name } }
    }
  }
`;

// #668: change an existing grantee's role.
export const UPDATE_MEMORY_SHARE_ROLE_MUTATION = /* GraphQL */ `
  mutation UpdateMemoryShareRole($memoryId: ID!, $granteeRef: String!, $role: MemoryShareRole!) {
    updateMemoryShareRole(memoryId: $memoryId, granteeRef: $granteeRef, role: $role) {
      memoryShare { role grantee { id handle name } }
    }
  }
`;

// #668: the PRINCIPAL revoking SOMEONE ELSE's share — deliberately a separate
// document from DELETE_MEMORY_SHARE_MUTATION above, which is the grantee's
// "leave" path.
//
// They are one server mutation distinguished ONLY by whether granteeRef is
// present, and those are different authorization paths: omit it and the server
// targets the CALLER's own row. Sharing one document would make a blank or
// dropped granteeRef silently change which row is deleted instead of failing —
// the `an-empty-flag-is-not-an-absent-flag` shape. `String!` here makes the
// variable non-optional, so a missing ref is a GraphQL error before it reaches
// a resolver that would have read it as "me".
export const REVOKE_MEMORY_SHARE_MUTATION = /* GraphQL */ `
  mutation RevokeMemoryShare($memoryRef: ID!, $granteeRef: String!) {
    deleteMemoryShare(memoryRef: $memoryRef, granteeRef: $granteeRef) {
      memoryId
      granteeId
    }
  }
`;

// #647: the caller's own (org-less, user-owned) agents — the "My agents" list.
// #782 (server): scoped SERVER-side via filter.ownedByMe (organizationId IS NULL
// AND ownerUserId = caller), for every caller INCLUDING platform ADMIN/OWNER —
// owner scope is never an admin-bypass surface. This replaced a client-side
// organizationId==null filter over the default list, which for an admin fetched
// EVERY agent system-wide before discarding almost all of it. Slim selection:
// just what the list table renders (name/urn/description/visibility + a count).
export const MY_AGENTS_QUERY = /* GraphQL */ `
  query MyAgents($limit: Int, $offset: Int) {
    agents(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
      items {
        id
        urn
        name
        description
        visibility
        organizationId
        systemMemoryId
        memoryItems { id }
      }
      total
    }
  }
`;

// #647: the caller's own (org-less, user-owned) apps — the "My apps" list.
// #782 (server): same server-side filter.ownedByMe scoping as MY_AGENTS_QUERY
// (organizationId IS NULL AND ownerUserId = caller, no admin bypass). Slim
// selection for the list table.
export const MY_APPS_QUERY = /* GraphQL */ `
  query MyApps($limit: Int, $offset: Int) {
    apps(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
      items {
        id
        urn
        name
        description
        organizationId
        appType
        agentId
        agent { id urn name }
      }
      total
    }
  }
`;

// #1230: layout and widget data stream independently; chart work must not
// hold navigation or prevent the saved layout from rendering its placeholders.
export const DASHBOARD_LAYOUT_QUERY = /* GraphQL */ `
  query DashboardLayout {
    dashboardWidgets { id type span rowSpan position config }
  }
`;

// Counts seed defaults; configured data remains server-owned and batched.
export const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard {
    # #1176 — the same slice as PERSONAL_MEMORIES_QUERY, and it has to stay
    # the same: this count and that list are the same claim on two pages.
    #
    # But this count is only the loader's FALLBACK. The dashboard loader does
    # "if (!widgetData['memory-stats'])", and the server's dashboardWidgetData
    # supplies it whenever present — so on a normal account the number a user
    # sees does NOT come from here. Measured at the time of this change: the
    # widget rendered 87 against a "My memories" list of 4, because the server's
    # MEMORY_STATS provider calls memories() with NO filter while its own
    # comment claims the count matches the portal's memory list exactly. That
    # is hadron-server's to fix; reported, not worked around.
    #
    # Swapping it here is still right — the fallback must not disagree with the
    # list it stands in for — but it does not fix the visible stat, and saying
    # otherwise would describe a repair this query did not make.
    memories(filter: { ownedByMe: true }, limit: 0) {
      total
    }
    agents(limit: 0) {
      total
    }
    dashboardWidgetData {
      widgetId
      type
      data
    }
  }
`;

// #796/#805: the public usage-activity time series — first used by the memory
// Usage tab's chart mode (the dashboard widget gets the same numbers through
// its data provider, which shares the server-side aggregation code path).
export const USAGE_ACTIVITY_QUERY = /* GraphQL */ `
  query UsageActivity($from: String, $to: String, $memoryRefs: [ID!], $timeZone: String) {
    usageActivity(from: $from, to: $to, memoryRefs: $memoryRefs, timeZone: $timeZone) {
      date
      reads
      writes
    }
  }
`;

// #806: named, user-scoped widget configurations — a palette the editor copies
// into a placement's config on apply (no live link). Fetched lazily alongside
// the memory options by /app/dashboard/editor-options.
export const DASHBOARD_WIDGET_PRESETS_QUERY = /* GraphQL */ `
  query DashboardWidgetPresets {
    dashboardWidgetPresets {
      id
      type
      name
      config
    }
  }
`;

export const CREATE_DASHBOARD_WIDGET_PRESET_MUTATION = /* GraphQL */ `
  mutation CreateDashboardWidgetPreset($type: DashboardWidgetType!, $name: String!, $config: JSON!) {
    createDashboardWidgetPreset(type: $type, name: $name, config: $config) {
      id
      type
      name
      config
    }
  }
`;

export const DELETE_DASHBOARD_WIDGET_PRESET_MUTATION = /* GraphQL */ `
  mutation DeleteDashboardWidgetPreset($presetRef: ID!) {
    deleteDashboardWidgetPreset(presetRef: $presetRef)
  }
`;

// #666: the usage-activity scope picker's option list — fetched lazily (only
// when the user enters Customize) by /app/dashboard/editor-options, which
// pages through the caller's full readable set rather than one capped page.
export const MEMORY_OPTIONS_QUERY = /* GraphQL */ `
  query MemoryOptions($limit: Int!, $offset: Int!) {
    memories(limit: $limit, offset: $offset) {
      items {
        id
        name
      }
      total
    }
  }
`;

// #636 / server #788: the in-place dashboard editor replaces the selection
// wholesale — the array IS the layout (position = array order). Placements
// carrying an `id` the caller owns are updated in place, so instance ids
// survive saves; span (1–12) and rowSpan (1–4) are clamped server-side.
export const SET_DASHBOARD_WIDGETS_MUTATION = /* GraphQL */ `
  mutation SetDashboardWidgets($widgets: [DashboardWidgetInput!]!) {
    setDashboardWidgets(widgets: $widgets) {
      id
      type
      span
      rowSpan
      position
      config
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

// The node page's "Test this flow" App list (#478), with each App's installed
// Agents so the run can name one (hadron-server#2849, portal#1444). Its own
// query, not a field on ORG_APP_INSTALLS_QUERY: that one feeds pages that do
// not render the roster.
export const ORG_APPS_RUNNABLE_QUERY = /* GraphQL */ `
  query OrgAppsRunnable($orgId: ID, $limit: Int, $offset: Int) {
    apps(orgId: $orgId, limit: $limit, offset: $offset) {
      items { id name appAgents { agent { id name urn } } }
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

// The ORG-wide runs audit list ("App Runs" sidebar section) — every run of
// every app in one org, not just one app's. Same resolver/gate as
// APP_RUNS_QUERY (org-READER, limit hard-capped 200); only the scope arg
// differs, and `orgRef` accepts an org id or URN.
export const ORG_APP_RUNS_QUERY = /* GraphQL */ `
  ${APP_RUN_FIELDS}
  query OrgAppRuns($orgRef: String, $status: AppRunStatus, $limit: Int, $offset: Int) {
    appRuns(orgRef: $orgRef, status: $status, limit: $limit, offset: $offset) {
      items { ...AppRunFields }
      total
    }
  }
`;

export const APP_RUN_QUERY = /* GraphQL */ `
  ${APP_RUN_FIELDS}
  query AppRun($ref: ID!) {
    appRun(ref: $ref) {
      ...AppRunFields
    }
  }
`;

// The run envelope — separate query because `AppRun.data` only exists from
// hadron-server#534 on; the detail loader degrades gracefully when the
// field is unknown instead of erroring the whole page.
export const APP_RUN_ENVELOPE_QUERY = /* GraphQL */ `
  query AppRunEnvelope($ref: ID!) {
    appRun(ref: $ref) {
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
// agentRef (hadron-server#2849, portal#1444) names the Agent when the App has
// several installed; omitted, the server uses the single one or refuses.
// `urn:` -> `nodeRef:` per hadron-server#542. That rename shipped a while ago
// and broke this mutation at runtime until #681; nothing caught it because the
// portal had no build-time validation.
export const RUN_TASK_APP_MUTATION = /* GraphQL */ `
  mutation RunTaskApp($nodeRef: String!, $args: JSON, $appRef: ID!, $runAsSelf: Boolean, $agentRef: ID) {
    runTask(nodeRef: $nodeRef, args: $args, appRef: $appRef, runAsSelf: $runAsSelf, agentRef: $agentRef)
  }
`;

// Apps an agent is installed into — for the agent detail page's Apps tab.
// Omit orgId so `apps` is member-scoped to EVERY app across the caller's orgs
// (an agent can be installed cross-org). Both `agentId` (primary) and the full
// `agents` join list are selected so a many-to-many install is caught, and
// `App.agents` is member-readable (unlike the admin-gated `Agent.apps`), so
// non-admin members see this too.
//
// portal#713: the `agents` join also feeds the "Bundled agents" tab — the
// SIBLINGS co-installed alongside this agent in the same App's install roster
// (a co-install writes no AgentImport edge). Hence the full projection here
// rather than a bare `{ id }`. Post-#974 these are role-actors, not named
// individuals: who is *cast* in that App is its Worker staff (WORKERS_QUERY).
const AGENT_APP_LITE_FIELDS = /* GraphQL */ `
  fragment AgentAppLiteFields on App {
    id
    name
    urn
    organizationId
    agents { id name urn description personaRole }
    appAgents { agent { id } }
  }
`;

// #472 / hadron-server#2343: `agentId` narrows the read to Apps whose AppAgent
// join installs this Agent, so the Agent detail load no longer drains every
// App the caller can see. The match is the join, not `App.agents`, so an App
// that hides an installed Agent from the caller still comes back, and the
// loader reads that from `appAgents { agent { id } }` (#1350): a join row whose
// `agent` is null is an install the caller cannot see. `App.agents` and
// `App.agentId` drop/mask such rows, so neither can carry that signal.
// An unreadable/unknown agent answers an empty page.
export const AGENT_APPS_QUERY = /* GraphQL */ `
  ${AGENT_APP_LITE_FIELDS}
  query AgentApps($agentId: ID, $limit: Int, $offset: Int) {
    apps(filter: { agentId: $agentId }, limit: $limit, offset: $offset) {
      items { ...AgentAppLiteFields }
      total
    }
  }
`;

// The org-less companion. `apps()` unfiltered scopes to the caller's MEMBER-ORG
// apps — App carries no userId, so org membership is the routing — and a
// user-owned (org-less) App is reachable only through `filter.ownedByMe` (#782).
// Without this second call an org-less team App is invisible to both the Apps
// tab and the Bundled agents tab, and createTeamPersona explicitly supports
// user-owned team Apps (PR #714 review, codex P2).
export const AGENT_OWNED_APPS_QUERY = /* GraphQL */ `
  ${AGENT_APP_LITE_FIELDS}
  query AgentOwnedApps($agentId: ID, $limit: Int, $offset: Int) {
    apps(filter: { ownedByMe: true, agentId: $agentId }, limit: $limit, offset: $offset) {
      items { ...AgentAppLiteFields }
      total
    }
  }
`;

// App queries/mutations are defined earlier in this file (above the
// Memory section) — APP_QUERY, CREATE_APP_MUTATION, UPDATE_APP_MUTATION,
// DELETE_APP_MUTATION, INSTALL_AGENT_INTO_APP_MUTATION,
// UNINSTALL_AGENT_FROM_APP_MUTATION, CREATE_APP_KEY_MUTATION,
// REVOKE_APP_KEY_MUTATION.

// ---------------------------------------------------------------------------
// Spec 025-oauth-for-mcp: user-scoped API keys (Bearer credentials for MCP).
// The /app/account/api-keys page reads + mutates via these three ops.
// ---------------------------------------------------------------------------

export const MY_USER_API_KEYS_QUERY = /* GraphQL */ `
  query MyUserApiKeys($includeHidden: Boolean = false) {
    myUserApiKeys(includeHidden: $includeHidden) {
      id
      keyPreview
      label
      createdAt
      lastUsedAt
      revokedAt
      hiddenAt
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
        hiddenAt
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
      hiddenAt
      issuedVia
    }
  }
`;

export const SET_USER_API_KEY_HIDDEN_MUTATION = /* GraphQL */ `
  mutation SetUserApiKeyHidden($id: ID!, $hidden: Boolean!) {
    setUserApiKeyHidden(id: $id, hidden: $hidden) {
      id
      hiddenAt
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
          properties
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

/**
 * #879 (@codex on #890) — which nodes the OTHER host judges, with no bodies.
 * A node declared only for the other host is scanned but not judged by the
 * EXPORT plan, so it is in neither its included nor its skipped set; this is
 * how the download names it anyway, from the server and uncapped. STATUS never
 * renders a body. Same non-empty `memories` rule as the EXPORT plan.
 */
/**
 * #882 — the server's lint verdict on stored declarations, for one host. LINT
 * touches no files and returns no bodies: findings only, per declared node. An
 * error finding is what makes the server withhold a node's body on export, so
 * the node edit page shows these rather than composing its own opinion.
 *
 * memories MUST be non-empty: the server reads an omitted or empty list as
 * every memory the caller can read.
 */
export const SKILL_PLAN_LINT_QUERY = /* GraphQL */ `
  query SkillPlanLint($host: String!, $memories: [String!]!) {
    skillPlan(input: { intent: LINT, host: $host, memories: $memories }) {
      entries {
        nodeId
        class
        findings {
          rule
          severity
          message
        }
      }
    }
  }
`;

export const SKILL_PLAN_STATUS_QUERY = /* GraphQL */ `
  query SkillPlanStatus($host: String!, $memories: [String!]!) {
    skillPlan(input: { intent: STATUS, host: $host, memories: $memories }) {
      entries {
        nodeId
        urn
        name
        class
      }
    }
  }
`;

/**
 * #879 — the server-rendered skill files for one host, for the Task Nodes
 * download. EXPORT with no `files` classifies every enabled declaration as
 * never-exported, so each entry the server judged writable carries its whole
 * SKILL.md in renderedBody (frontmatter, provenance header, body). The portal
 * writes that verbatim and renders nothing itself.
 *
 * #1075 — EXPORT selects its memories by a persisted Scope (`scopeRef`) and
 * REFUSES `memories`, even an empty list (hadron-server#1429: "EXPORT cannot
 * select memories; use scopeRef"). The scope must be non-empty and is never
 * omitted here: an omitted `scopeRef` is an unscoped export of every memory the
 * caller can read. LINT and STATUS keep `memories`.
 */
export const SKILL_PLAN_EXPORT_QUERY = /* GraphQL */ `
  query SkillPlanExport($host: String!, $scopeRef: ID!) {
    skillPlan(input: { intent: EXPORT, host: $host, scopeRef: $scopeRef }) {
      scanned
      judged
      unrecognized {
        nodeId
        urn
        name
        keyCount
        keys
        findings {
          rule
          severity
          message
        }
      }
      entries {
        nodeId
        urn
        name
        class
        renderedBody
        exportPlan {
          action
          reasons {
            code
            message
          }
        }
        findings {
          rule
          severity
          message
        }
      }
    }
  }
`;

// #937 (server#1378): test a SAVED config by id, of any owner kind, through the
// server's own run path. The stored key never leaves the server; `override`
// tests edited-but-unsaved values without storing them.
export const TEST_AI_SERVICE_CONFIG_MUTATION = /* GraphQL */ `
  mutation TestAiServiceConfig($id: ID!, $override: AiServiceConfigTestOverride) {
    testAiServiceConfig(id: $id, override: $override) {
      ok
      provider
      model
      endpoint
      apiStyle
      used { provider model endpoint apiStyle key }
      latencyMs
      reply
      error { code message transient }
    }
  }
`;

// ---------------------------------------------------------------------------
// #942 — Channel management (spec 049 phase 4). An App's Channels, the App's
// default, and the caller's WRITE standing on the App's shared memory (the
// host an App-scoped create targets). Channel reads are gated on the host
// memory: a Channel you may not read is simply not in the page.
// ---------------------------------------------------------------------------

export const APP_CHANNELS_APP_QUERY = /* GraphQL */ `
  query AppChannelsApp($ref: ID!) {
    app(ref: $ref) {
      id
      name
      urn
      organizationId
      defaultChannel { id }
      sharedMemory { id urn name }
    }
  }
`;

/** #942: one page of an App's Channels. Page it with `fetchAllItems`: the list caps at 200.
 *
 * #2509: `memoryId` survives the host record's concealment — `memory` comes
 * back null for a caller who may see the Channel but not its memory's record. */
export const APP_CHANNELS_QUERY = /* GraphQL */ `
  query AppChannels($appRef: ID!, $limit: Int, $offset: Int) {
    channels(filter: { appRef: $appRef }, limit: $limit, offset: $offset) {
      total
      items {
        id
        name
        description
        kind
        loc
        chatRootUrn
        chatRootNodeId
        lastSeq
        lastMessageAt
        createdAt
        memoryId
        memory { id urn name }
      }
    }
  }
`;

/** #942: the host an App-scoped Channel create targets: the App's shared memory. */
/**
 * #942: one page of an ORGANIZATION's Channels, those whose host memory
 * belongs to it (`channels(orgId:)`), and only those the caller may read.
 * Page it with `fetchAllItems`: the list caps at 200.
 *
 * #2509: `memoryId` survives the host record's concealment — `memory` comes
 * back null for a caller who may see the Channel but not its memory's record. */
export const ORG_CHANNELS_QUERY = /* GraphQL */ `
  query OrgChannels($orgId: ID!, $limit: Int, $offset: Int) {
    channels(orgId: $orgId, limit: $limit, offset: $offset) {
      total
      items {
        id
        name
        description
        kind
        loc
        chatRootUrn
        chatRootNodeId
        lastSeq
        lastMessageAt
        createdAt
        memoryId
        memory { id urn name }
      }
    }
  }
`;

/**
 * #942: an organization's Apps with their URNs: whose Workers and installed
 * Agents an org-owned register row may name. The URN keeps a Worker's App
 * addressable when two Apps share a display name.
 */
export const ORG_APPS_FOR_REGISTER_QUERY = /* GraphQL */ `
  query OrgAppsForRegister($orgId: ID, $limit: Int, $offset: Int) {
    apps(orgId: $orgId, limit: $limit, offset: $offset) {
      items { id name urn }
      total
    }
  }
`;

/**
 * #942: the caller's standing in an organization, for deciding what the org
 * Channels page OFFERS (org register rows need CONTRIBUTOR+ on the server).
 * Slim on purpose: the members tab's query carries emails and avatars.
 */
export const ORG_MEMBER_ROLES_QUERY = /* GraphQL */ `
  query OrgMemberRoles($ref: ID!) {
    organization(ref: $ref) {
      id
      members { role user { id } }
    }
  }
`;

export const APP_SHARED_MEMORY_QUERY = /* GraphQL */ `
  query AppSharedMemory($ref: ID!) {
    app(ref: $ref) { id sharedMemory { id } }
  }
`;

/**
 * #942: may the caller write this memory? `resource` MUST be the memory's
 * `hrn:mem:` URN: a bare id is read as an AiServiceConfig id and answers
 * NOT_FOUND.
 */
export const SELF_CAN_WRITE_QUERY = /* GraphQL */ `
  query SelfCanWrite($user: ID!, $resource: ID!) {
    effectiveAccess(user: $user, resource: $resource) { canWrite }
  }
`;

export const CREATE_CHANNEL_MUTATION = /* GraphQL */ `
  mutation CreateChannel($input: CreateChannelInput!) {
    createChannel(input: $input) { id loc name }
  }
`;

export const UPDATE_CHANNEL_MUTATION = /* GraphQL */ `
  mutation UpdateChannel($ref: ID!, $input: UpdateChannelInput!) {
    updateChannel(ref: $ref, input: $input) { id name description }
  }
`;

export const DELETE_CHANNEL_MUTATION = /* GraphQL */ `
  mutation DeleteChannel($ref: ID!) {
    deleteChannel(ref: $ref)
  }
`;

// ---------------------------------------------------------------------------
// #942 slice 3 — the register (spec 049 phase 5): who attends which Channel.
// A row declares INTENT, never permission. Read gate (§8.6): host memory
// readable OR the caller is on the row's owner side; `channel` is null to an
// owner-side reader who may not read its host.
// ---------------------------------------------------------------------------

const REGISTER_ENTRY_FIELDS = /* GraphQL */ `
  fragment RegisterEntryFields on RegisterEntry {
    id
    ownerType
    ownerId
    appId
    organizationId
    channelId
    channel { id name loc chatRootUrn }
    attendeeWorkerId
    attendeeAgentId
    attendeeUrn
    role
    mentionOnly
    installDefault
    description
    createdAt
  }
`;

export const REGISTER_ENTRIES_BY_OWNER_QUERY = /* GraphQL */ `
  ${REGISTER_ENTRY_FIELDS}
  query RegisterEntriesByOwner($ownerRef: ID!, $limit: Int, $offset: Int) {
    registerEntries(filter: { ownerRef: $ownerRef }, limit: $limit, offset: $offset) {
      total
      items { ...RegisterEntryFields }
    }
  }
`;

/** The Agents installed in an App: the attendee picker's second half (Workers are the first). */
export const APP_INSTALLED_AGENTS_QUERY = /* GraphQL */ `
  query AppInstalledAgents($ref: ID!) {
    app(ref: $ref) { id appAgents { agent { id name urn } } }
  }
`;

/**
 * #942: may the caller manage this entity (an App's register rows)? A
 * self-audit. `resource` MUST be the entity's URN (`hrn:app:` …): a bare id is
 * read as an AiServiceConfig id and answers NOT_FOUND.
 */
export const SELF_CAN_MANAGE_QUERY = /* GraphQL */ `
  query SelfCanManage($user: ID!, $resource: ID!) {
    effectiveAccess(user: $user, resource: $resource) { canManage }
  }
`;

// portal#1142 S8 (hadron-server#2219) — boot-prompt pointers. Each read is its
// own small query, kept OUT of the shared Agent/Worker fragments that feed
// other routes, so a failed read is told apart from a masked (null) one.
// Both fields are null when no pointer is set OR the reader may not see it.
export const AGENT_BOOT_POINTER_QUERY = /* GraphQL */ `
  query AgentBootPointer($ref: ID!) {
    agent(ref: $ref) { id bootPromptRef bootPromptTargetDeleted }
  }
`;

// portal#1378 — what "Start a source" reads server-side, never from the page: the Agent's system memory and pointer.
export const AGENT_BOOT_START_QUERY = /* GraphQL */ `
  query AgentBootStart($ref: ID!) {
    agent(ref: $ref) { id systemMemoryId bootPromptRef bootPromptTargetDeleted }
  }
`;

// portal#1377 S1 — the two nodes behind an Agent's Boot prompt tab. raw: true
// (#485): the source is an editor, so include tags must round-trip unexpanded.
// The compiled node is read for its approval (the status line) and, when the source
// itself can't be read, its text (R1 c: a reader sees the compiled prompt read-only).
export const BOOT_SOURCE_QUERY = /* GraphQL */ `
  query BootSource($ref: ID!, $memoryRef: ID!) {
    node(ref: $ref, memoryRef: $memoryRef, raw: true) { id urn revision content }
  }
`;

export const BOOT_COMPILED_QUERY = /* GraphQL */ `
  query BootCompiled($ref: ID!) {
    node(ref: $ref, raw: true) {
      id urn revision content
      approvalStatus { state approval { revision } }
      lintWarnings(first: 50) { items { kind position text targetUrn pinnedRevision newerRevision workerField } total nextCursor }
    }
  }
`;

// portal#1377 S2 — setPointer is omitted, so the server default (true) applies:
// the compiled loc is fixed, so the pointer keeps naming the same node.
export const COMPILE_AGENT_BOOT_PROMPT_MUTATION = /* GraphQL */ `
  mutation CompileAgentBootPrompt($agentRef: String!) {
    compileAgentBootPrompt(agentRef: $agentRef) {
      revNo contentHash pointerSet
      node { id urn revision lintWarnings(first: 50) { items { kind position text targetUrn pinnedRevision newerRevision workerField } total nextCursor } }
    }
  }
`;

// The App's install rows, joined to the Agents tab by agent id. A row whose
// agent is withheld (null) can't be joined and shows as not shown.
export const APP_BOOT_POINTERS_QUERY = /* GraphQL */ `
  query AppBootPointers($ref: ID!) {
    app(ref: $ref) { id appAgents { agent { id } bootPromptRef bootPromptTargetDeleted } }
  }
`;

export const WORKER_BOOT_POINTER_QUERY = /* GraphQL */ `
  query WorkerBootPointer($ref: ID!) {
    worker(ref: $ref) { id bootPromptRef bootPromptTargetDeleted }
  }
`;

// The setters: nodeRef is REQUIRED; an explicit null clears. GraphQL only (R24).
export const SET_AGENT_BOOT_PROMPT_MUTATION = /* GraphQL */ `
  mutation SetAgentBootPrompt($agentRef: String!, $nodeRef: String) {
    setAgentBootPrompt(agentRef: $agentRef, nodeRef: $nodeRef) { id bootPromptRef bootPromptTargetDeleted }
  }
`;

export const SET_APP_AGENT_BOOT_PROMPT_MUTATION = /* GraphQL */ `
  mutation SetAppAgentBootPrompt($appRef: String!, $agentRef: String!, $nodeRef: String) {
    setAppAgentBootPrompt(appRef: $appRef, agentRef: $agentRef, nodeRef: $nodeRef) { bootPromptRef bootPromptTargetDeleted }
  }
`;

/** portal#1357 (hadron-server#2645): a strict patch of a task's descriptive fields. */
export const UPDATE_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation UpdateAgentTask($taskId: ID!, $input: UpdateAgentTaskInput!) {
    updateAgentTask(taskId: $taskId, input: $input) { id }
  }
`;

export const SET_WORKER_BOOT_PROMPT_MUTATION = /* GraphQL */ `
  mutation SetWorkerBootPrompt($workerRef: ID!, $nodeRef: String) {
    setWorkerBootPrompt(workerRef: $workerRef, nodeRef: $nodeRef) { id bootPromptRef bootPromptTargetDeleted }
  }
`;

export const CREATE_REGISTER_ENTRY_MUTATION = /* GraphQL */ `
  mutation CreateRegisterEntry($input: CreateRegisterEntryInput!) {
    createRegisterEntry(input: $input) { id }
  }
`;

export const UPDATE_REGISTER_ENTRY_MUTATION = /* GraphQL */ `
  mutation UpdateRegisterEntry($ref: ID!, $input: UpdateRegisterEntryInput!) {
    updateRegisterEntry(ref: $ref, input: $input) { id role mentionOnly description }
  }
`;

export const DELETE_REGISTER_ENTRY_MUTATION = /* GraphQL */ `
  mutation DeleteRegisterEntry($ref: ID!) {
    deleteRegisterEntry(ref: $ref)
  }
`;

// #942 slice 4 — an attendee's RESOLVED register (spec 049 phase 6): one
// winning row per Channel. Since server #1560, canRead/canPost/disclosure
// describe the ATTENDEE. Viewer visibility separately gates hostMemoryUrn;
// the portal words standing only when that host memory is visible.
export const ATTENDEE_REGISTER_QUERY = /* GraphQL */ `
  query AttendeeRegister($workerRef: ID, $agentRef: ID, $appRef: ID) {
    attendeeRegister(workerRef: $workerRef, agentRef: $agentRef, appRef: $appRef) {
      namedBy
      lastSeenSeq
      canRead
      canPost
      disclosure
      attendeeUrn
      entry { id ownerType role mentionOnly installDefault }
      channel { id name loc hostMemoryUrn lastSeq lastMessageAt deleted }
    }
  }
`;

// #992 (hadron-server#1591 PR 1) — node approvals. A single-node read only:
// `Node.approvalStatus` costs a per-row lookup, so it is never selected on a
// list (team chat #6300); lists filter by `NodeFilter.approvalState` instead.
export const NODE_APPROVAL_QUERY = /* GraphQL */ `
  query NodeApproval($ref: ID!) {
    node(ref: $ref) {
      id
      revision
      approvalStatus {
        state
        approval { revision approvedAt approvedBy { handle urn } approvedByInfo hash }
      }
      # #992 slice C (server #1591 PR 2): the same single-node read carries
      # the mint stamp, bound to the rendered revision with the approval.
      mintStatus { minted mintedAt mintedBy { handle urn } mintedByInfo revision hash }
    }
  }
`;

// portal#1022 (hadron-server#1864) — a node's passkey signatures. Its own
// single-node read, NOT a field on NODE_APPROVAL_QUERY: the signing surfaces
// sit behind a server switch (hadron-server#1895), and a refusal there must
// never take the approval and mint status down with it. `revision` binds the
// derived states to the revision the page rendered.
export const NODE_SIGNATURES_QUERY = /* GraphQL */ `
  query NodeSignatures($ref: ID!) {
    node(ref: $ref) {
      id
      revision
      signatureStatus {
        state
        integrityProblems
        signatures { id signer { handle urn } passkeyLabel passkeyRevokedAt revision verifiedAt state }
      }
    }
  }
`;

// `revision` pins the approval to the revision the reader saw: an edit in
// between answers REVISION_MISMATCH instead of approving text never reviewed.
export const APPROVE_NODE_MUTATION = /* GraphQL */ `
  mutation ApproveNode($nodeRef: ID!, $revision: Int) {
    approveNode(nodeRef: $nodeRef, revision: $revision) {
      nodeId
      approval { revision approvedAt }
    }
  }
`;

export const VERIFY_NODE_QUERY = /* GraphQL */ `
  query VerifyNode($nodeRef: ID!) {
    verifyNode(nodeRef: $nodeRef) { state revision approvedRevision expectedHash actualHash }
  }
`;
// #992 (hadron-server#1591): approve the current revision of every live,
// unminted node of a memory that isn't approved yet, in one transaction.
// Only the counts and the skipped placeholders are read: the receipts list
// can run to the whole memory.
export const APPROVE_MEMORY_NODES_MUTATION = /* GraphQL */ `
  mutation ApproveMemoryNodes($memoryRef: String!) {
    approveMemoryNodes(memoryRef: $memoryRef) {
      approvedCount
      alreadyApprovedCount
      skippedPlaceholders
      # portal#1014 (hadron-server#1607): nodes with open discussions, a
      # warning shown with the result (hrn:node:hadronmemory.com:specs:cor:dmo:110:07).
      unresolvedFeedback { urn openThreads }
    }
  }
`;

// #992 (hadron-server#1591 PR 2): mint every unminted live node of a memory.
// `dryRun` returns the full report without minting; the portal always runs one
// first and offers the real run only when nothing blocks. Finding `message`
// is not selected: the portal renders fixed copy per kind.
export const MINT_MEMORY_NODES_MUTATION = /* GraphQL */ `
  mutation MintMemoryNodes($memoryRef: ID!, $dryRun: Boolean) {
    mintMemoryNodes(memoryRef: $memoryRef, dryRun: $dryRun) {
      dryRun
      minted
      mintedCount
      mintLocs
      blockers { kind loc rule targetLoc }
      openQuestions { decider questions { loc } }
      # portal#1014 (hadron-server#1607): nodes with open discussion threads.
      # Warnings, never blockers (hrn:node:hadronmemory.com:specs:cor:dmo:110:07).
      unresolvedFeedback { urn openThreads }
    }
  }
`;

// ---------------------------------------------------------------------------
// portal#1052 — the App's agent tasks, read-only (Holger #10660): the board,
// task detail, subtask tree and history. Each selects exactly what a view
// renders (hrn:node:hadronmemory.com:hadron-portal:review:graphql-fetch-rendered-subfields).
// The App's participants read them; anyone else gets APP_NOT_FOUND
// (hrn:node:hadronmemory.com:specs:cor:agt:050:21).
// ---------------------------------------------------------------------------

const AGENT_TASK_PARTY_FIELDS = /* GraphQL */ `
  fragment AgentTaskPartyFields on AgentTaskParty { id kind name urn }
`;

const AGENT_TASK_ROW_FIELDS = /* GraphQL */ `
  fragment AgentTaskRowFields on AgentTask {
    id
    handle
    parentTaskId
    title
    status
    queued
    waitingOnChildren
    priority
    blocked
    source
    owner { id kind name urn }
    assignee { id kind name urn }
    startBy
    createdAt
    updatedAt
    tags
  }
`;

/** The App light enough for a sub-route's header (no agents, no keys). */
export const AGENT_TASKS_APP_QUERY = /* GraphQL */ `
  query AgentTasksApp($ref: ID!) {
    app(ref: $ref) { id name urn organizationId }
  }
`;

export const AGENT_TASKS_BOARD_QUERY = /* GraphQL */ `
  ${AGENT_TASK_ROW_FIELDS}
  query AgentTasksBoard($appRef: ID!, $status: [AgentTaskStatus!], $queued: Boolean, $limit: Int, $text: String, $overdue: Boolean, $tagsAll: [String!]) {
    agentTasks(appRef: $appRef, rootsOnly: true, status: $status, queued: $queued, limit: $limit, text: $text, overdue: $overdue, tagsAll: $tagsAll) {
      ...AgentTaskRowFields
    }
  }
`;

export const AGENT_TASK_DETAIL_QUERY = /* GraphQL */ `
  ${AGENT_TASK_PARTY_FIELDS}
  ${AGENT_TASK_ROW_FIELDS}
  query AgentTaskDetail($id: ID!) {
    agentTask(id: $id) {
      ...AgentTaskRowFields
      appId
      description
      requirements { role familyIn familyNotIn excludeWorkerIds minTier }
      createdBy { ...AgentTaskPartyFields }
      createdByRunId
      assignedAt
      assignedBy { ...AgentTaskPartyFields }
      startedAt
      finishedAt
      cancelledAt
      closeSessionWhenDone
      result { outcome summary evidence }
      sessionEndRequest { requestedAt dueAt resolution resolvedAt }
      properties
    }
  }
`;

/** A breadcrumb ancestor: its title and its own parent, nothing else. */
export const AGENT_TASK_ANCESTOR_QUERY = /* GraphQL */ `
  query AgentTaskAncestor($id: ID!) {
    agentTask(id: $id) { id handle title parentTaskId }
  }
`;

export const AGENT_TASK_TREE_QUERY = /* GraphQL */ `
  ${AGENT_TASK_ROW_FIELDS}
  query AgentTaskTree($root: ID!) {
    agentTaskTree(root: $root) { ...AgentTaskRowFields }
  }
`;

export const AGENT_TASK_EVENTS_QUERY = /* GraphQL */ `
  ${AGENT_TASK_PARTY_FIELDS}
  query AgentTaskEvents($appRef: ID!, $taskId: ID!, $after: ID, $limit: Int) {
    agentTeamEvents(appRef: $appRef, taskId: $taskId, after: $after, limit: $limit) {
      id
      type
      severity
      createdAt
      actor { ...AgentTaskPartyFields }
      actorRunId
      subjectWorker { ...AgentTaskPartyFields }
      payload
      acknowledgedAt
      acknowledgedBy { ...AgentTaskPartyFields }
      wakes { chainIndex dueAt wokenAt owner { ...AgentTaskPartyFields } }
    }
  }
`;

// portal#1052 slice 2 — the Roster and the Alarms list.

export const TEAM_ROSTER_QUERY = /* GraphQL */ `
  query TasksTeamRoster($appRef: ID!) {
    teamRoster(appRef: $appRef) {
      asOf
      workers {
        worker { id kind name urn }
        role
        state
        family
        freeFamilies
        launchableFamilies
        unavailableFamilies
        unavailableReason
        unavailableUntil
        bound
        liveSession
        lastActiveAt
        lastAssignedAt
        reportsTo { id kind name urn }
        reportsToRetired
        startedTasks
        pendingTasks
        waitingOn
        waitingSince
        unreactedChildTask
        alarms
      }
    }
  }
`;

// portal#1316 (hadron-server#2061 / #2475): the direct-report lanes and the
// server's headcounts. Selects exactly the SDL's closed projection: no task,
// holder or status field, and nothing the page would have to join or recount.
export const TEAM_COMPOSITION_QUERY = /* GraphQL */ `
  query TasksTeamComposition($appRef: ID!) {
    teamComposition(appRef: $appRef) {
      appId
      asOf
      lanes {
        coordinator { id kind name urn }
        coordinatorRetired
        workers {
          worker { id kind name urn }
          role
          family
          bound
          liveSession
          state
        }
        countsByRole { role count }
        countsByRoleFamily { role family count }
      }
    }
  }
`;

// portal#1168: pause intent ONLY. The input is built by the action and carries
// exactly one of pausedUntil / clearPause, never `mentions`; the server's gate
// (the worker, its holder or an App manager) decides who may.
export const SET_WORKER_WAKE_SETTINGS_MUTATION = /* GraphQL */ `
  mutation SetWorkerPause($workerRef: String!, $input: WorkerWakeSettingsInput!) {
    setWorkerWakeSettings(workerRef: $workerRef, input: $input) { pausedUntil }
  }
`;

// portal#1168 (hadron-server#2178): the AI Team grid's Task and Paused state,
// one bulk read joined to the staff by worker id. Selects only what the grid
// renders.
export const APP_TEAM_ROSTER_QUERY = /* GraphQL */ `
  query AppTeamRoster($appRef: ID!) {
    teamRoster(appRef: $appRef) {
      workers {
        worker { id }
        checkStatus { status pendingReason }
        pausedUntil
        currentTask { id title status }
        # portal#1492: state, reason and age only — never the host label or prompt.
        terminal { status reason checkedAt }
      }
    }
  }
`;

/**
 * portal#1349: one task reference, read through the server's readable-task gate
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:21), to put a title and the
 * immutable handle on a bare id the roster, alarms or AI Team grid carries.
 * `appId` is selected only so the caller can refuse a task of another App.
 */
export const AGENT_TASK_REF_QUERY = /* GraphQL */ `
  query AgentTaskRef($id: ID!) {
    agentTask(id: $id) { id appId handle title }
  }
`;

export const AGENT_ALARMS_QUERY = /* GraphQL */ `
  query AgentAlarms($appRef: ID!, $after: ID, $limit: Int) {
    agentTeamEvents(appRef: $appRef, alarmsOnly: true, after: $after, limit: $limit) {
      id
      type
      severity
      taskId
      createdAt
      subjectWorker { id kind name urn }
      acknowledgedAt
      acknowledgedBy { id kind name urn }
      wakes { chainIndex dueAt wokenAt owner { id kind name urn } }
    }
  }
`;

// ---------------------------------------------------------------------------
// portal#1090 — task writes (create, assign, reassign, cancel, make ready,
// park). Each write
// selects only the id: the page reloads its data afterwards, never trusting
// an optimistic view.
// ---------------------------------------------------------------------------

export const CREATE_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation CreateAgentTask($input: CreateAgentTaskInput!) {
    createAgentTask(input: $input) { id handle }
  }
`;

export const ASSIGN_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation AssignAgentTask($taskId: ID!, $assignee: AgentTaskPartyInput!, $closeSessionWhenDone: Boolean) {
    assignAgentTask(taskId: $taskId, assignee: $assignee, closeSessionWhenDone: $closeSessionWhenDone) { id }
  }
`;

export const REASSIGN_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation ReassignAgentTask($taskId: ID!, $assignee: AgentTaskPartyInput!, $closeSessionWhenDone: Boolean) {
    reassignAgentTask(taskId: $taskId, assignee: $assignee, closeSessionWhenDone: $closeSessionWhenDone) { id }
  }
`;

export const CANCEL_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation CancelAgentTask($taskId: ID!) {
    cancelAgentTask(taskId: $taskId) { id }
  }
`;

export const MAKE_AGENT_TASK_READY_MUTATION = /* GraphQL */ `
  mutation MakeAgentTaskReady($taskId: ID!) {
    makeAgentTaskReady(taskId: $taskId) { id }
  }
`;

export const PARK_AGENT_TASK_MUTATION = /* GraphQL */ `
  mutation ParkAgentTask($taskId: ID!) {
    parkAgentTask(taskId: $taskId) { id }
  }
`;

/** The App's people, for the owner and assignee pickers: id, handle and name only. */
export const APP_PEOPLE_QUERY = /* GraphQL */ `
  query AppPeople($ref: ID!) {
    app(ref: $ref) { id members { user { id handle name } } }
  }
`;

// #1023: only the server may authorize a verified-unused casting repair.
export const DELETE_WORKER_MUTATION = /* GraphQL */ `
  mutation DeleteWorker($workerRef: ID!, $confirmNoExternalAttribution: Boolean!) {
    deleteWorker(workerRef: $workerRef, confirmNoExternalAttribution: $confirmNoExternalAttribution)
  }
`;

// #1142 P3: reads remain bounded to the selected App + installed Agent.
export const INSTALL_TARGET_QUERY = /* GraphQL */ `
  query InstallTarget($ref: ID!) {
    app(ref: $ref) {
      id
      agents {
        id
        systemMemoryId
      }
    }
  }
`;
export const INSTALL_MEMORY_QUERY = /* GraphQL */ `
  query InstallMemory($appRef: String!, $agentRef: String!) {
    installMemory(appRef: $appRef, agentRef: $agentRef) {
      id
      urn
    }
  }
`;
export const INSTALL_NODES_QUERY = /* GraphQL */ `
  query InstallNodes($memoryRef: ID!, $offset: Int!) {
    memoryNodes(memoryRef: $memoryRef, limit: 20, offset: $offset) {
      nodes {
        id
        loc
        name
      }
      total
    }
  }
`;
export const INSTALL_NODE_QUERY = /* GraphQL */ `
  query InstallNode($memoryRef: ID!, $ref: ID!) {
    node(memoryRef: $memoryRef, ref: $ref, raw: true) {
      id
      urn
      loc
      name
      content
      revision
      role
      isRunnable
    }
  }
`;
export const ORIGINAL_NODE_QUERY = /* GraphQL */ `
  query OriginalNode($memoryRef: ID!, $ref: ID!) {
    node(memoryRef: $memoryRef, ref: $ref, raw: true) {
      id
      urn
      loc
      name
      content
      revision
      role
      isRunnable
    }
  }
`;
export const CREATE_CUSTOMISATION_MUTATION = /* GraphQL */ `
  mutation CreateCustomisation($input: CreateNodeInput!) {
    createNode(input: $input) {
      id
      loc
      revision
    }
  }
`;

// #1352: server#2644 merged wire; each edit retains the shared taskWrite semantics.
export const SET_AGENT_TASK_PRIORITY_MUTATION = /* GraphQL */ `
  mutation SetAgentTaskPriority($taskRef: ID!, $priority: Int!) {
    setAgentTaskPriority(taskRef: $taskRef, priority: $priority) { id }
  }
`;
export const ADD_AGENT_TASK_BLOCKER_MUTATION = /* GraphQL */ `
  mutation AddAgentTaskBlocker($taskRef: ID!, $blockerTaskRef: ID!) {
    addAgentTaskBlocker(taskRef: $taskRef, blockerTaskRef: $blockerTaskRef) { id }
  }
`;
export const REMOVE_AGENT_TASK_BLOCKER_MUTATION = /* GraphQL */ `
  mutation RemoveAgentTaskBlocker($taskRef: ID!, $blockerTaskRef: ID!) {
    removeAgentTaskBlocker(taskRef: $taskRef, blockerTaskRef: $blockerTaskRef) { id }
  }
`;

export const TASK_PICKER_QUERY = /* GraphQL */ `
  query TaskPicker($appRef: ID!, $offset: Int!) {
    agentTasks(appRef: $appRef, status: [BACKLOG, PENDING, STARTED], limit: 200, offset: $offset) {
      id appId title handle status
    }
  }
`;
export const TASK_PICKER_EXACT_QUERY = /* GraphQL */ `
  query TaskPickerExact($id: ID!) { agentTask(id: $id) { id appId title handle status } }
`;
export const TASK_DEPENDENCIES_QUERY = /* GraphQL */ `
  query TaskDependencies($id: ID!, $offset: Int!) {
    agentTask(id: $id) {
      id appId
      blockedBy(limit: 200, offset: $offset) { items { id appId title handle status } hasMore }
      blocks(limit: 200, offset: $offset) { items { id appId title handle status } hasMore }
    }
  }
`;

// #1033: arbitrary registered Channels use the same envelope and stable seq cursors.
export const CHANNEL_MESSAGES_QUERY = /* GraphQL */ `
  # #793: beforeSeq (server #1116) is the BACKWARD mirror of sinceSeq — only
  # messages with seq strictly less than it are considered, and the NEWEST of
  # those are returned. The server IGNORES offset when beforeSeq is given, which
  # is the point: an offset is an index into a list whose length changes under a
  # reader while workers post, so it skips or duplicates mid-scroll. seq is
  # atomic and unique per chat, so the cursor is stable.
  query ChannelMessages($channelRef: ID!, $sinceSeq: Int, $beforeSeq: Int, $limit: Int, $offset: Int) {
    channelMessages(channelRef: $channelRef, sinceSeq: $sinceSeq, beforeSeq: $beforeSeq, limit: $limit, offset: $offset) {
      items {
        nodeId
        seq
        body
        at
        authorUserId
        authorWorkerId
        authorName
        sessionId
        replyToSeq
        mentions
        # #855 / server#1209: the message node's canonical URN, composed
        # server-side since a message loc carries a random component. Null
        # when it cannot be emitted in grammar v2; the thread then shows no
        # message chip.
        urn
      }
      total
    }
  }
`;

export const APP_CHAT_TARGET_QUERY = /* GraphQL */ `
  query AppChatTarget($ref: ID!) { app(ref: $ref) { id } }
`;
export const CHANNEL_CHAT_TARGET_QUERY = /* GraphQL */ `
  query ChannelChatTarget($ref: ID!) { channel(ref: $ref) { id memory { appId } } }
`;
export const CREATE_CHANNEL_MESSAGE_MUTATION = /* GraphQL */ `
  mutation CreateChannelMessage($channelRef: ID!, $body: String!, $replyToSeq: Int) {
    createChannelMessage(channelRef: $channelRef, body: $body, replyToSeq: $replyToSeq) { nodeId seq body at authorName }
  }
`;
