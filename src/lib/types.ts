export interface Memory {
  id: string;
  organizationId: string;
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
  visibility: 'PUBLIC' | 'PRIVATE' | 'ORGANIZATION';
  type?: 'KNOWLEDGE' | 'AGENT_SYSTEM';
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
  visibility: 'PUBLIC' | 'PRIVATE' | 'ORGANIZATION';
  type?: 'ASSISTANT' | 'CHATBOT';
  surfaces?: string[];
  aiProvider?: string | null;
  aiModel?: string | null;
  hasAiApiKey?: boolean;
  properties: Record<string, unknown> | null;
  memoryItems: AgentMemoryItem[];
  createdAt: string;
}

/** A saved chat in a user's personal memory for an agent. */
export interface Chat {
  id: string;
  loc: string;
  title: string;
  conversationName: string | null;
  stageName: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
}

/** One message in a chat history. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  seq: number | null;
  createdAt: string;
}

export interface App {
  id: string;
  name: string;
  urn: string;
  organizationId: string;
  createUserPermission: 'DENY' | 'EXPLICIT' | 'IMPLICIT';
  identifyUserMethod: 'USER_ID' | 'SECRET';
  sessionTimeoutSeconds: number;
  anonymousTtlDays: number;
  agents: Array<{ id: string; urn: string; name: string }>;
  keys: AppKey[];
  createdAt: string;
  updatedAt: string | null;
}

export interface AppKey {
  id: string;
  keyPreview: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentMemoryItem {
  id: string;
  role: string;
  memory: { id: string; urn: string; name: string; visibility: 'PUBLIC' | 'PRIVATE' | 'ORGANIZATION' };
}

export interface StationAgentSub {
  id: string;
  agent: { id: string; urn: string; name: string; description: string | null; systemPrompt?: string | null; memoryItems?: AgentMemoryItem[] };
  subscriptionType: 'READ_ONLY' | 'READ_WRITE';
  trainingMode: boolean;
  createdAt: string;
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
  isVisible: boolean | null;
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
}

export interface NodeEdge {
  id: string;
  label: string;
  source: NodeSummary;
  target: NodeSummary;
}

export interface MemoryNode {
  id: string;
  memoryId: string;
  nodeType: string;
  loc: string;
  name: string;
  alias: string | null;
  description: string | null;
  content: string | null;
  tokens: number | null;
  tags: string[];
  seq: number | null;
  data: Record<string, unknown> | null;
  ownerRepo: string | null;
  isRunnable: boolean | null;
  createdAt: string;
  updatedAt: string;
  memory?: { id: string; urn: string; name: string; organizationId?: string } | null;
  outgoingEdges: NodeEdge[];
  incomingEdges: NodeEdge[];
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
  stationId: string | null;
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
// Station types
// ---------------------------------------------------------------------------

export interface StationKey {
  id: string;
  stationId: string;
  userId: string;
  label: string | null;
  keyPreview: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Station {
  id: string;
  urn: string;
  name: string;
  stationType: string;
  description: string | null;
  systemPrompt: string | null;
  role: string;
  agentTools: string[];
  organizationId: string | null;
  userId: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  hasAiApiKey: boolean;
  user?: UserSummary | null;
  agentSubscriptions?: StationAgentSub[];
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
// AI provider config (encrypted at rest on the station)
// ---------------------------------------------------------------------------

export type AIProvider = 'anthropic' | 'openai' | 'glm';

export interface StationAIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}
