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
    # #974 (hrn:node:hadronmemory.com:specs:cor:agt:020 v0.0.3): persona dressing on a reusable role-actor.
    # personaPrompt is a TEMPLATE (name/role bound when the agent is cast as a
    # Worker); the named individual is the Worker, not the Agent. personaName
    # was dropped from the schema with the Worker model — do not reintroduce it
    # (selecting an unknown field fails the whole request).
    # NB: no backticks in this file's GraphQL comments — the operations are
    # template literals, so a backtick terminates the string (portal#715).
    personaRole
    personaPrompt
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
    # #974: the App's install ROSTER (every installed Agent via the AppAgent
    # join) — which role-actors are available to CAST as workers. Distinct from
    # the App's STAFF, which are its Workers (WORKERS_QUERY). personaRole is
    # selected because casting defaults a worker's role to it.
    # Member-readable, unlike the admin-gated Agent.apps.
    agents { id urn name personaRole }
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

export const APP_DETAIL_ORG_WITH_AGENTS_QUERY = /* GraphQL */ `
  ${APP_DETAIL_ORG_FIELDS}
  query AppDetailOrgWithAgents($ref: ID!) {
    organization(ref: $ref) {
      ...AppDetailOrgFields
      agents {
        id
        name
        urn
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
    promptOverride
    memoryId
    retiredAt
    # #1050 — who HOLDS this name, and since when. A hold belongs to a person
    # and survives expiry, a reap and a closed chat session; only an explicit
    # release frees it (hrn:node:hadronmemory.com:specs:cor:agt:020:09).
    #
    # WORKING-STATE fields: behind the worker read gate and MASKED TO NULL ON
    # DENY, exactly like promptOverride and memoryId above, and unlike
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
 * #1010 — amend a worker's promptOverride, the per-worker individuality layered
 * over the role agent's shared template.
 *
 * `promptOverride` REPLACES the whole override; it is not appended. The trap
 * this repo must not build is a "save the boot briefing" control: the composed
 * briefing is bound-template + override + a derived register block, so writing
 * it back folds the shared template into the override and prepends it again on
 * every render, compounding each save. Only the override is writable, and
 * `updateWorker` takes only the override — the server offers no way to write
 * the composed prompt at all.
 *
 * Refuses WORKER_RETIRED for a retired casting (which takes no new bindings, so
 * an override could never be delivered) and requires staffing access.
 */
export const UPDATE_WORKER_MUTATION = /* GraphQL */ `
  mutation UpdateWorker($workerRef: ID!, $promptOverride: String) {
    updateWorker(workerRef: $workerRef, promptOverride: $promptOverride) {
      id
      promptOverride
    }
  }
`;

export const WORKER_QUERY = /* GraphQL */ `
  ${WORKER_FIELDS}
  query Worker($ref: ID!) {
    worker(ref: $ref) {
      ...WorkerFields
      app { id name urn organizationId }
      # #1010 — the agent's RAW persona template, merged into the fragment's
      # agent selection rather than added to WorkerFields: the fragment also
      # feeds the Staff roster, and a template per row is the hadron-cli#459
      # mistake in miniature. Selected here for the Briefing tab's Source view,
      # which shows the inherited half read-only beside the editable override.
      # (NB no backticks in this file's GraphQL comments — one terminates the
      # template literal, portal#715. The gate caught exactly that here.)
      #
      # NOT derivable from the composed prompt by subtraction: resolvers.worker.ts
      # builds it as bound-template + override + a DERIVED register block
      # (spec 049 Phase 6) evaluated per reader, so the composed string does not
      # end with the override and slicing it would mis-cut.
      #
      # Nullable twice over: the agent may carry no template, AND this goes
      # through the AGENT read gate while the composed prompt sits behind the
      # worker's own (maySeeWorkerInternals) — so a caller who can read the
      # briefing may still get null here. Render that as "not visible to you",
      # never as "no template".
      agent { personaPrompt }
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

// The App's staff. Retired castings are hidden unless includeRetired — they
// keep their name reserved forever, so showing them is how a reader
// understands why a name cannot be reused.
export const WORKERS_QUERY = /* GraphQL */ `
  ${WORKER_FIELDS}
  query Workers($appRef: ID!, $includeRetired: Boolean, $limit: Int, $offset: Int) {
    workers(appRef: $appRef, includeRetired: $includeRetired, limit: $limit, offset: $offset) {
      items { ...WorkerFields }
      total
    }
  }
`;

// Cast an ALREADY-INSTALLED agent under a name.
//
// #760: `name` is REQUIRED. hadron-server#1050 removed the Team Agent's
// cast-list register, so omitting it no longer draws the next free name — it is
// refused with WORKER_NAME_REQUIRED. Omitting `role` still defaults to the
// agent's personaRole, which that change did not touch.
//
// The argument stays `name: String` (nullable) in the SDL because the refusal
// is a RUNTIME one, which keeps it typed and mappable rather than a schema
// rejection; do not read the nullability as "optional".
//
// Typed refusals: WORKER_NAME_TAKEN, WORKER_NAME_REQUIRED,
// WORKER_AGENT_NOT_INSTALLED, WORKER_AGENT_NOT_FOUND, WORKER_AGENT_AMBIGUOUS,
// APP_UNINSTALLED. WORKER_ROLE_NOT_FOUND and the TEAM_AGENT_* codes went with
// the register — they fired only because a nameless cast had to read one.
export const CAST_WORKER_MUTATION = /* GraphQL */ `
  ${WORKER_FIELDS}
  mutation CastWorker($appRef: ID!, $agentRef: ID, $role: String, $name: String, $promptOverride: String) {
    castWorker(appRef: $appRef, agentRef: $agentRef, role: $role, name: $name, promptOverride: $promptOverride) {
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

// #636: single-agent find-one (full fields) by id/URN. `agent(ref:)` is
// membership-gated for org agents, owner-gated for user-owned (org-less) agents,
// and admits PUBLIC agents — so the detail page can resolve BOTH org and
// user-owned agents through one owner-accessible path (replacing the old
// organizations()-scan that only found org agents).
export const AGENT_QUERY = /* GraphQL */ `
  ${AGENT_FIELDS}
  query Agent($ref: ID!) {
    agent(ref: $ref) { ...AgentFields }
  }
`;

export const UPDATE_AGENT_MUTATION = /* GraphQL */ `
  ${AGENT_FIELDS}
  mutation UpdateAgent($ref: ID!, $name: String, $urn: String, $description: String, $systemPrompt: String, $systemMemoryId: String, $visibility: AgentVisibility, $personaRole: String, $personaPrompt: String) {
    updateAgent(ref: $ref, name: $name, urn: $urn, description: $description, systemPrompt: $systemPrompt, systemMemoryId: $systemMemoryId, visibility: $visibility, personaRole: $personaRole, personaPrompt: $personaPrompt) { ...AgentFields }
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
    $description: String, $systemPrompt: String, $agentTools: [String!],
    $aiProvider: String, $aiModel: String, $aiApiKey: String,
    $expiresAt: String,
    $createUserPermission: CreateUserPermission,
    $identifyUserMethod: IdentifyUserMethod,
    $sessionTimeoutSeconds: Int, $anonymousTtlDays: Int
  ) {
    updateApp(
      ref: $ref, name: $name, urn: $urn, appType: $appType, role: $role,
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
  mutation RegenerateAppKey($appRef: ID!) {
    regenerateAppKey(appRef: $appRef) { rawKey app { ...AppFields } }
  }
`;

// ---------------------------------------------------------------------------
// App Keys
// ---------------------------------------------------------------------------

// An argument and its $variable share a name — `appKeys(appRef: $appRef)`.
// `pnpm gql:validate` checks that, and cross-checks the keys every caller
// passes, so a mismatch is a build error rather than a convention to remember.
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
// promptOverride) would let a former App member read current staffing off a
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
  query TeamChatMessages($appRef: ID!, $sinceSeq: Int, $beforeSeq: Int, $limit: Int, $offset: Int) {
    teamChatMessages(appRef: $appRef, sinceSeq: $sinceSeq, beforeSeq: $beforeSeq, limit: $limit, offset: $offset) {
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
      }
      total
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
 * #911 — just enough of a node to plan its memory: its id and its memoryId.
 * The single-skill endpoint needs nothing else, so it does not reuse the node
 * page's full read (properties, asset, content) and invoke resolvers it would
 * never render.
 */
export const NODE_MEMORY_REF_QUERY = /* GraphQL */ `
  query NodeMemoryRef($ref: ID!) {
    node(ref: $ref) {
      id
      memoryId
    }
  }
`;

export const NODE_BY_ID_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  ${ASSET_FIELDS}
  query NodeById($ref: ID!) {
    node(ref: $ref, raw: true) {
      ...NodeFields
      # #518: properties is detail-only — kept OUT of the shared NodeFields
      # fragment so it doesn't bloat search/list payloads (NODE_FIND_QUERY
      # spreads the same fragment; PR #523 review, codex).
      properties
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

// #629 / #636: the dashboard fetches everything it needs in ONE request:
//  - count-only memory/agent totals (limit:0 — they seed the default widgets'
//    data; the "Your memories" preview was dropped, so no items),
//  - the caller's placed widgets (dashboardWidgets, ordered by position), and
//  - the combined per-widget-type data (dashboardWidgetData) — server #772/#773.
// The portal maps the server enum to WidgetType and fans the data out by type.
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
    dashboardWidgets {
      id
      type
      span
      rowSpan
      position
      config
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
// `urn:` -> `nodeRef:` per hadron-server#542. That rename shipped a while ago
// and broke this mutation at runtime until #681; nothing caught it because the
// portal had no build-time validation.
export const RUN_TASK_APP_MUTATION = /* GraphQL */ `
  mutation RunTaskApp($nodeRef: String!, $args: JSON, $appRef: ID!, $runAsSelf: Boolean) {
    runTask(nodeRef: $nodeRef, args: $args, appRef: $appRef, runAsSelf: $runAsSelf)
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
    agentId
    agents { id name urn description personaRole }
  }
`;

export const AGENT_APPS_QUERY = /* GraphQL */ `
  ${AGENT_APP_LITE_FIELDS}
  query AgentApps($limit: Int, $offset: Int) {
    apps(limit: $limit, offset: $offset) {
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
  query AgentOwnedApps($limit: Int, $offset: Int) {
    apps(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
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
 * memories MUST be non-empty: the server reads an omitted or empty list as
 * every memory the caller can read.
 */
export const SKILL_PLAN_EXPORT_QUERY = /* GraphQL */ `
  query SkillPlanExport($host: String!, $memories: [String!]!) {
    skillPlan(input: { intent: EXPORT, host: $host, memories: $memories }) {
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
