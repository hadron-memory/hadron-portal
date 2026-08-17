// The asset projection is owned by the asset surface ($lib/api/assetUpload),
// which both the client helpers and the GraphQL fragment already speak.
import type { AssetSummary } from '$lib/api/assetUpload';

export interface Memory {
  id: string;
  /**
   * Owning org — NULL for a user-owned (org-less) memory (spec 047: personal /
   * private memories created with no orgId, `ownerUserId` = caller). The
   * `chk_memory_owner_xor` constraint makes org and user ownership mutually
   * exclusive, so this is null exactly when the memory belongs to a user.
   */
  organizationId: string | null;
  organization?: OrgSummary;
  urn: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  tags: string[];
  license: string | null;
  category0: string | null;
  category1: string | null;
  category2: string | null;
  iconUrl: string | null;
  heroUrl: string | null;
  homeUrl: string | null;
  source: string | null;
  readBranch: string | null;
  writeBranch: string | null;
  // Spec 034: MemoryVisibility pruned to {PUBLIC, ORGANIZATION, GROUP},
  // nullable — meaningful only for knowledge (PUBLIC vs ORG) and group (GROUP);
  // null for owner-only (personal/private) and the app/system classes. The old
  // PERSONAL/PRIVATE values are removed (privacy is now the class, not visibility).
  visibility: 'PUBLIC' | 'ORGANIZATION' | 'GROUP' | null;
  // Spec 005-agent-subscription introduced the four-way memory class
  // typology. Spec 013-soft-delete-memory reads `class` and `userId` to
  // gate the detail-page Danger-zone affordance: personal-class memories
  // are owner-deletable; all others are org-admin-deletable.
  // Spec 034-memory-class-access: `personal` and `private` are owner-only
  // (free-standing, owned via Memory.userId); `group` is team-shared. All are
  // user-creatable via createMemory(memoryClass:).
  class?: 'system' | 'app' | 'knowledge' | 'personal' | 'private' | 'group';
  // 008-agent-installation: App pivot for app/personal-class memories, NULL
  // otherwise. Doubles as the appRef for App-scoped platform operations —
  // notably team chat, which lives in its App's shared app-class memory.
  appId?: string | null;
  isEncrypted?: boolean;
  // Spec 033-rag-vector-retrieval: per-memory vector-index config. Chunk
  // dials are nullable (null = platform default 512 / 64). vectorIndexEncryptedAckAt
  // is the FR-026 disclosure-acceptance timestamp (null until acknowledged).
  vectorIndexEnabled?: boolean;
  embeddingSource?: 'abstract' | 'contentChunks' | 'both';
  chunkTokens?: number | null;
  chunkOverlap?: number | null;
  forceFixedSize?: boolean;
  vectorIndexEncryptedAckAt?: string | null;
  // #588 (server #725): opt-in per-memory property schema — declared
  // collections + typed fields. NULL = unstructured. Parse with
  // readMemorySchema() ($lib/schema/memory-schema) before driving editors.
  schema?: Record<string, unknown> | null;
  // 006-asset-upload-redesign: per-memory upload-acceptance gate. Default true;
  // false for system-class memories. Optional here because not every projection
  // selects it — treat `undefined` as "unknown", not as "refuses uploads", or a
  // slim projection would silently hide the affordance everywhere.
  acceptsUploads?: boolean;
  userId?: string | null;
  userMemoryOfAgentId?: string | null;
  anonymousExpiresAt?: string | null;
  agent?: { id: string; urn: string; name: string } | null;
  syncStatus: 'PENDING' | 'SYNCING' | 'OK' | 'ERROR';
  syncError: string | null;
  pendingEdgeCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptions?: MemorySubscription[];
}

export interface MemorySubscription {
  id: string;
  role: string;
  activated: boolean;
  createdAt: string;
  memory: Memory;
  organization: OrgSummary;
}

export interface Agent {
  id: string;
  organizationId: string;
  urn: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  systemMemoryId: string | null;
  // Spec 035: Agent.visibility is its own AgentVisibility enum (decoupled from
  // MemoryVisibility). PERSONAL = creator-only draft (named PERSONAL, not
  // PRIVATE, so it never collides with the memory `private` class).
  visibility: 'PUBLIC' | 'ORGANIZATION' | 'PERSONAL';
  type?: 'ASSISTANT' | 'CHATBOT';
  surfaces?: string[];
  // #974 (cor:agt:020 v0.0.3): persona is *dressing* on any Agent, not an
  // identity — the Agent is the reusable role-actor ("backend-engineer") and
  // `personaPrompt` is a TEMPLATE ({{name}}/{{role}} bound at casting time).
  // The named individual is a Worker (see below); `Agent.personaName` was
  // dropped from the schema with the Worker model.
  personaRole?: string | null;
  personaPrompt?: string | null;
  // 036-ai-service-config: server shim — true when the agent's `default`
  // config has a key. Used by the Chat-tab readiness gate.
  hasAiApiKey?: boolean;
  properties: Record<string, unknown> | null;
  memoryItems: AgentMemoryItem[];
  // 008-agent-installation
  memoryProvisioning?: MemoryProvisioning;
  installationPolicy?: InstallationPolicy;
  imports?: AgentImport[];
  appCount?: number;
  createdAt: string;
}

export interface MemoryProvisioning {
  appMemory: 'shared' | 'user' | 'none';
}

export interface InstallationPolicy {
  /**
   * Integer-as-string OR the sentinel 'unlimited'. GraphQL returns it as a string;
   * `parseInt(maxMembers)` succeeds for integer values, 'unlimited' is the sentinel.
   */
  maxMembers: string;
  memberRoles: string[];
}

export interface AgentImport {
  parentAgentId: string;
  importedAgentId: string;
  importedAgent: {
    id: string;
    urn: string;
    name: string;
    description?: string | null;
    personaRole?: string | null;
  };
  position: number;
  required: boolean;
  createdAt: string;
}

/** A saved chat — private chats live in the user's personal memory; shared chats live in the App's app-class memory. */
export interface Chat {
  id: string;
  loc: string;
  title: string;
  conversationName: string | null;
  stageName: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
  /** Spec 017 — chat-scope tier. */
  scope: 'private' | 'shared';
  /** Spec 017 — chat author (chat-root createdBy). Null on legacy chats. */
  createdBy: string | null;
}

/** One message in a chat history. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  seq: number | null;
  createdAt: string;
}

/**
 * One message in a team App's TEAM CHAT (server #939) — a different thing from
 * `ChatMessage` above, which is a turn in an agent chat session.
 *
 * The distinction that matters when rendering: an agent chat message has a
 * `role` (user vs assistant), while a team chat message has an AUTHOR — either
 * a worker or a human, never both. Collapsing the two is what made the team
 * chat unreadable when it was mistakenly listed on the agent-chat surface
 * (hadron-server#1030): a renderer keyed on `role` has nothing to key on here
 * and renders every teammate identically.
 */
export interface TeamChatMessage {
  /** The message node's id. */
  nodeId: string;
  /** Ordering key, unique per chat, allocated atomically ascending from 1.
   *  Also the address teammates cite each other by ("seq 14"), so it is shown. */
  seq: number;
  body: string;
  at: string;
  /** Set when a human posted. Mutually exclusive with `authorWorkerId`. */
  authorUserId: string | null;
  /** Set when a worker posted, via the driving worker session. */
  authorWorkerId: string | null;
  /** Display convenience: the worker name or the user handle. */
  authorName: string | null;
  /** The worker session driving the worker author, when posted via sessionRef. */
  sessionId: string | null;
  /** The seq this message replies to, when it is a reply. */
  replyToSeq: number | null;
  /** Extracted server-side at write time. The portal never parses bodies. */
  mentions: string[];
}

/**
 * One record in a team App's WORKLOG (server #947) — an externally visible work
 * milestone: a PR opened, a branch pushed, an issue closed.
 *
 * This is the authoritative artifact-to-session join (`cor:agt:020:05`), not a
 * display convenience. Several records sharing one `ref` is the DESIGNED shape,
 * not duplication: a PR worked across three worker sessions produces three
 * records and three transcripts (how many distinct WORKERS that is depends on
 * `workerName` — one worker driven across three sequential sessions produces
 * the same three rows). Deduping them destroys the answer
 * the worklog exists to give.
 *
 * Append-only. There is no edit and no delete — a wrong record is corrected by
 * recording a newer one.
 */
export interface TeamWorkItem {
  /** The record node's id. */
  nodeId: string;
  /** The worker session the work is attributed to. */
  sessionId: string;
  /**
   * Denormalized at write, and the field to RENDER. It resolves for a retired
   * worker and, for pre-#974 records, carries the stored personaName — both of
   * which a live join through `workerId` would lose.
   */
  workerName: string;
  /** The Worker behind the record, when the session was worker-bound. The LINK
   *  target; never the display source. */
  workerId: string | null;
  /** The external tool the artifact lives in ('github', …). Lowercased. */
  tool: string;
  /** Artifact kind: pr, issue, commit, branch, or repo. */
  kind: string;
  /** The canonical artifact ref — the equality-lookup key. */
  ref: string;
  /** What happened: opened, merged, reviewed, closed, pushed, … */
  action: string;
  /** When the record was made (server-stamped). */
  at: string;
  /** Display extras (title, URL). Documented as never filtered on. */
  detail: Record<string, unknown> | null;
}

export interface App {
  id: string;
  name: string;
  urn: string;
  organizationId: string;
  appType: AppType;
  role: AppMembershipRole;
  description: string | null;
  systemPrompt: string | null;
  agentTools: string[];
  expiresAt: string | null;
  // App-original fields
  createUserPermission: 'DENY' | 'EXPLICIT' | 'IMPLICIT';
  identifyUserMethod: 'USER_ID' | 'SECRET';
  sessionTimeoutSeconds: number;
  anonymousTtlDays: number;
  // 008-agent-installation: direct FK to Agent (replaces the AppAgent join).
  agentId: string | null;
  agent: AppAgentSummary | null;
  // Spec 021 US1: server-computed R2 canonical install URN
  // (hrn:agent:<installing-org>::<app-slug>::<author-org>:<agent-slug>).
  // Optional because not every query that returns App fetches this
  // field — it lives outside the shared AppFields fragment so list
  // views, mutations, etc. don't hard-depend on a server-side field
  // that's only needed by the App detail page. Null when fetched but
  // the App has no agent attached.
  installedAgentUrn?: string | null;
  surfaces: string[];
  memberCount: number;
  trainingMode: boolean;
  members?: AppMember[];
  /**
   * The App's install ROSTER — every Agent installed via the AppAgent join.
   * These are reusable ROLE-ACTORS, i.e. which agents are available to cast;
   * the App's STAFF are its {@link Worker}s (the named castings). Do not read
   * this list as "who works here".
   */
  agents: Array<{ id: string; urn: string; name: string; personaRole?: string | null }>;
  keys: AppKey[];
  createdAt: string;
  updatedAt: string | null;
}

export type AppType = 'WORKSTATION' | 'CHATBOT' | 'AGENT' | 'AUTOMATION' | 'CLOUD' | 'IOT';
export type AppMembershipRole = 'OWNER' | 'ADMIN' | 'CONTRIBUTOR' | 'READER';

/**
 * A Worker (#974, `cor:dmo:050:11`) — the named casting of an installed Agent
 * into an App: "Iris", the backend-engineer agent cast into the eng-team App.
 * The Agent carries reusable persona dressing; the Worker is the local named
 * identity that does attributable work.
 *
 * The App's **staff** are its Workers; the `AppAgent` join is only the install
 * ROSTER (which agents are available to cast). Names are unique per App,
 * case-insensitively, FOREVER — retirement and uninstall never free one — so
 * inside an App context the bare `name` is unambiguous (`cor:agt:020:02`).
 *
 * Workers have **no URN** and their names never appear in slugs, so identity is
 * always these columns; there is nothing to parse.
 */
export interface Worker {
  id: string;
  appId: string;
  agentId: string;
  /** The worker's name ("Iris") — the identity every surface renders. */
  name: string;
  /** The cast-list role this filling answers ("backend-engineer"). */
  role: string | null;
  /** Per-worker individuality layered over the agent's template prompt. */
  promptOverride: string | null;
  /** The worker-scoped working memory in the App's container (null until provisioned). */
  memoryId: string | null;
  /** The role-agent behind the casting. */
  agent: { id: string; name: string; urn: string; personaRole?: string | null } | null;
  /**
   * Retirement instant — a retired worker stops authoring and takes no new
   * sessions, but the row and its name reservation survive.
   */
  retiredAt: string | null;
  createdAt: string;
}

export interface AppKey {
  id: string;
  appId?: string;
  keyPreview: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentMemoryItem {
  id: string;
  role: string;
  memory: { id: string; urn: string; name: string; visibility: 'PUBLIC' | 'ORGANIZATION' | 'GROUP' | null };
}

/** The Agent payload returned from App.agent. */
export interface AppAgentSummary {
  id: string;
  urn: string;
  name: string;
  description: string | null;
  systemPrompt?: string | null;
  surfaces?: string[];
  memoryItems?: AgentMemoryItem[];
  installationPolicy?: InstallationPolicy;
}

/** 008-agent-installation: User↔App membership. */
export interface AppMember {
  appId: string;
  userId: string;
  role: string;
  user: UserSummary;
  createdAt: string;
  updatedAt: string | null;
}

export interface OrgSummary {
  id: string;
  name: string;
  urn: string;
}

export interface Organization {
  id: string;
  name: string;
  urn: string;
  githubInstallationId: number | null;
  githubAppId: string | null;
  hasGithubAppPrivateKey: boolean;
  createdAt: string;
  updatedAt: string;
  members?: OrgMember[];
  memories?: Memory[];
  agents?: Agent[];
  apps?: App[];
  subscriptions?: MemorySubscription[];
  exchangeConnections?: ExchangeConnection[];
}

export interface OrgMember {
  id: string;
  role: string;
  canInvite: boolean;
  createdAt: string;
  user: UserSummary;
}

export interface UserSummary {
  id: string;
  handle: string | null;
  githubUsername: string | null;
  name: string | null;
  avatarUrl: string | null;
  email?: string | null;
  roles?: string[];
  maxReferrals?: number | null;
}

// ---------------------------------------------------------------------------
// Node / Edge types (from hadron-server GraphQL)
// ---------------------------------------------------------------------------

export interface NodeSummary {
  id: string;
  loc: string;
  name: string;
  description: string | null;
  tags: string[];
  // #350: edge endpoints carry their memory's URN so the Edges table can
  // render the endpoint node's full URN (memory urn + loc), and so the edge
  // detail page can route under the endpoint's owning memory. Nullable: GraphQL
  // may return null (node with no memory object), not just omit the field.
  memory?: { id: string; urn: string } | null;
}

export interface NodeEdge {
  id: string;
  // Spec 037: edges are first-class. `name` (was `label`) is now nullable;
  // `loc` is the edge's identity + URN suffix.
  name: string | null;
  loc: string;
  description?: string | null;
  isRunnable?: boolean | null;
  // #350: populated only by EDGE_HOST_NODE_QUERY (the edge detail page); the
  // lean NODE_FIELDS fragment omits them to keep graph/browse payloads small.
  condition?: unknown;
  priority?: number | null;
  data?: unknown;
  // #656 (server #783): NULLABLE — an endpoint is null when it lives in a memory
  // the caller can't read (a cross-memory edge's far end, typically reached via
  // incomingEdges). A same-memory edge the caller can already see always has
  // both. Treat null as an opaque "private" endpoint; never dereference it.
  source: NodeSummary | null;
  target: NodeSummary | null;
}

// #529: a NodeRevision snapshot (server type, #623 rename from NodeVersion),
// listed in the node History tab. `content` is only selected by the single-
// revision (Display) query — optional here.
export interface NodeRevision {
  id: string;
  nodeId?: string;
  loc: string;
  name: string;
  alias: string | null;
  description: string | null;
  content?: string | null;
  tags: string[];
  editedBy: string | null;
  // #620 display contract: editedByUser (resolved handle + URN) is preferred;
  // else editedByInfo (identity string like 'github:<login>' / 'app:<id>');
  // revLabel is the edit reason/label.
  editedByInfo?: string | null;
  editedByUser?: { handle: string | null; urn: string | null } | null;
  revLabel?: string | null;
  // #620: node fields the edit changed, e.g. ["abstract","tags"]; empty on
  // legacy rows captured before the column existed.
  changes?: string[];
  createdAt: string;
}

export interface MemoryNode {
  id: string;
  memoryId: string;
  nodeType: string;
  // #588 (server #725): collection discriminator (which domain object this
  // node is, e.g. "competitor"). Null for an ordinary node; orthogonal to
  // nodeType.
  objectType?: string | null;
  loc: string;
  name: string;
  alias: string | null;
  description: string | null;
  abstract: string | null;
  content: string | null;
  tokens: number | null;
  tags: string[];
  seq: number | null;
  data: Record<string, unknown> | null;
  // #518: structured key-value metadata (server Node.properties, JSON). Often
  // server-set provenance (e.g. properties.url / .title from the write seam).
  // Optional: only the node-detail read (NODE_BY_ID_QUERY) selects it — it's
  // kept off the shared NodeFields fragment so search/list payloads stay lean.
  properties?: Record<string, unknown> | null;
  ownerRepo: string | null;
  isRunnable: boolean | null;
  createdAt: string;
  updatedAt: string;
  memory?: { id: string; urn: string; name: string; organizationId?: string; appId?: string | null } | null;
  /**
   * portal#696 / server#888: the asset this node references, for a `reference`
   * node whose `data.asset` points at one (written by createAssetReferenceNode or
   * hadron_store_file). Optional here because only the node-detail read selects
   * it, and null for every ordinary node.
   *
   * Null ALSO means a DANGLING pointer — the asset was hard- or soft-deleted.
   * There is no Asset→Node foreign key (cor:dmo:060:10 reserves it), so a node
   * carrying `data.asset` is not a promise that a live asset is behind it.
   */
  asset?: AssetSummary | null;
  outgoingEdges: NodeEdge[];
  incomingEdges: NodeEdge[];
}

/**
 * #432: per-hit metadata `findNodes` returns alongside each node, surfaced on
 * search-result rows. Keyed by node id.
 *
 * `scorePct` is a RELATIVE relevance indicator — the hit's score as a percentage
 * of the top hit's score in the same result set. findNodes' raw `score` is NOT
 * comparable across modes (keyword ts_rank vs. vector cosine vs. hybrid RRF —
 * hadron-server#497), so the meaningful signal is the within-set relative rank,
 * not the absolute number. Null for an unscored (no-query) filtered list.
 *
 * The rest come from `hit.vector`, present only when a hit came from the vector
 * index (fuzzy / hybrid): `abstractStale` flags a possibly-out-of-date preview
 * (spec 032), and similarity/model power a "why did this match" tooltip.
 */
export interface SearchHitMeta {
  scorePct: number | null;
  abstractStale: boolean;
  similarity: number | null;
  model: string | null;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Usage types
// ---------------------------------------------------------------------------

export interface UsageSummaryEntry {
  nodeLoc: string;
  type: string;
  count: number;
}

export interface UsageEvent {
  id: string;
  type: string;
  nodeLoc: string | null;
  appId: string | null;
  sessionId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Graph view types (derived from MemoryNode[])
// ---------------------------------------------------------------------------

export interface TreeEntry {
  id: string;       // loc
  nodeId: string | null;  // DB primary key (null for virtual nodes)
  name: string;
  seq: number | null;
  nodeType: string;
  hasActions: boolean;
  isVirtual: boolean;
}

export interface TopicNode {
  id: string;
  rel: string;       // edge label
  loc: string;       // target loc
  name: string;
}

export interface Topic {
  id: string;         // DB primary key (used as vis-network node ID)
  loc: string;        // memory-relative path
  urn: string;        // full URN: memory.urn + ":" + loc
  name: string;
  depth: number;
  description: string;
  tags: string[];
  domain: string;     // first segment of loc
  nodes: TopicNode[]; // outgoing edges
  readOnly?: boolean;
}

export interface FolderNode {
  id: string;
  name: string;
  domain: string;
  isDomain: boolean;
}

export interface HierEdge {
  from: string;
  to: string;
}

export interface GraphViewData {
  topics: Topic[];
  folderNodes: FolderNode[];
  hierEdges: HierEdge[];
}

// ---------------------------------------------------------------------------
// Exchange integration
// ---------------------------------------------------------------------------

export interface ExchangeConnection {
  id: string;
  organizationId: string;
  userId: string;
  mailboxEmail: string;
  displayName: string | null;
  syncEnabled: boolean;
  syncStatus: 'PENDING' | 'SYNCING' | 'OK' | 'ERROR';
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AI provider config (encrypted at rest on the App)
// ---------------------------------------------------------------------------

export type AIProvider = 'anthropic' | 'openai' | 'glm' | 'bedrock';

export interface AppAIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

// ---------------------------------------------------------------------------
// 036-ai-service-config: the named AI-config registry. A config is owned by
// exactly one of HadronServer / Organization / App / Agent and resolved by
// name (App → Agent → Org → HadronServer). The masked list never carries key
// material beyond the preview.
// ---------------------------------------------------------------------------

export type AiConfigOwnerType = 'HADRON_SERVER' | 'ORGANIZATION' | 'APP' | 'AGENT';

export interface AiServiceConfig {
  id: string;
  name: string;
  ownerType: AiConfigOwnerType;
  ownerId: string;
  provider: AIProvider;
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  params: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Spec 025-oauth-for-mcp: user-scoped API keys (Bearer credentials for MCP).
// Mirror of the Phase 1 `UserApiKey` GraphQL type. The raw `hdr_user_<…>`
// value is never stored — it surfaces exactly once in
// `UserApiKeyCreateResult.rawKey` at mint time and never appears again.
// ---------------------------------------------------------------------------

export interface UserApiKey {
  id: string;
  keyPreview: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  // `'portal'` for keys minted via the GraphQL `createUserApiKey`;
  // `'oauth:<client_id>'` for tokens minted by `POST /oauth/token`.
  // Powers the source badge in the revocation UI so a user can tell
  // which OAuth client issued a token.
  issuedVia: string | null;
}

export interface UserApiKeyCreateResult {
  userApiKey: UserApiKey;
  rawKey: string;
}

// ---------------------------------------------------------------------------
// Access check (#375) — effectiveAccess result shape (hadron-server #323).
// ---------------------------------------------------------------------------

export interface AccessGrant {
  /** AccessSource enum: PLATFORM_ROLE, ORG_ROLE, PUBLIC_VISIBILITY, … */
  source: string;
  /** The role/level this particular grant confers. */
  role: string;
  /** Human label for the grant's origin (owning org URN, etc.); may be null. */
  via: string | null;
}

export interface EffectiveAccess {
  /** Subject — only the fields EFFECTIVE_ACCESS_QUERY selects. */
  user: Pick<UserSummary, 'id' | 'handle' | 'name' | 'email'>;
  /** Canonical URN of the resolved resource (or AiServiceConfig id). */
  resourceUrn: string;
  /** memory | node | app | agent | aiServiceConfig. */
  resourceKind: string;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
  canDelete: boolean;
  /** Highest single clean role label, or null when capability-based/absent. */
  role: string | null;
  /** Reasons access is granted; empty = no access. Ordered strongest-first. */
  grants: AccessGrant[];
}
