export interface Memory {
  id: string;
  organizationId: string;
  organization?: OrgSummary;
  name: string;
  source: string | null;
  readBranch: string | null;
  writeBranch: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
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
  name: string;
  description: string | null;
  memoryItems: AgentMemoryItem[];
  createdAt: string;
}

export interface AgentMemoryItem {
  id: string;
  memory: { id: string; name: string };
}

export interface StationAgentSub {
  id: string;
  agent: { id: string; name: string; description: string | null };
  subscriptionType: 'READ_ONLY' | 'READ_WRITE';
  trainingMode: boolean;
  createdAt: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  domain: string;
}

export interface Organization {
  id: string;
  name: string;
  domain: string;
  isVisible: boolean | null;
  githubInstallationId: number | null;
  githubAppId: string | null;
  hasGithubAppPrivateKey: boolean;
  createdAt: string;
  updatedAt: string;
  members?: OrgMember[];
  memories?: Memory[];
  agents?: Agent[];
  subscriptions?: MemorySubscription[];
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
  title: string;
  description: string | null;
  tags: string[];
  namespace: string;
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
  loc: string;
  name: string;
  title: string;
  alias: string | null;
  description: string | null;
  content: string | null;
  tokens: number | null;
  tags: string[];
  namespace: string;
  ownerRepo: string | null;
  isRunnable: boolean | null;
  createdAt: string;
  updatedAt: string;
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
  name: string;
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
  id: string;         // loc
  name: string;
  depth: number;
  description: string;
  tags: string[];
  domain: string;     // first segment of loc
  nodes: TopicNode[]; // outgoing edges
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

export interface Station {
  id: string;
  label: string;
  stationType: string;
  description: string | null;
  role: string;
  apiKeyShown: boolean;
  namespace: string | null;
  agentTools: string[];
  organizationId: string | null;
  userId: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  user?: UserSummary | null;
  agentSubscriptions?: StationAgentSub[];
}
