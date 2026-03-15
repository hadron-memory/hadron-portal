export interface Graph {
  id: string;
  organizationId: string;
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
  subscriptions?: GraphSubscription[];
}

export interface GraphSubscription {
  id: string;
  role: string;
  activated: boolean;
  createdAt: string;
  graph: Graph;
  organization: OrgSummary;
}

export interface GraphBundle {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  graphs: GraphBundleGraph[];
  createdAt: string;
}

export interface GraphBundleGraph {
  id: string;
  graph: { id: string; name: string };
}

export interface ClientBundleSub {
  id: string;
  bundle: { id: string; name: string; description: string | null };
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
  githubInstallationId: number | null;
  createdAt: string;
  updatedAt: string;
  members?: OrgMember[];
  graphs?: Graph[];
  graphBundles?: GraphBundle[];
  subscriptions?: GraphSubscription[];
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
  githubUsername: string;
  name: string | null;
  avatarUrl: string | null;
  email?: string | null;
  roles?: string[];
  maxReferrals?: number | null;
}

export interface Client {
  id: string;
  label: string;
  clientType: string;
  description: string | null;
  role: string;
  apiKeyShown: boolean;
  namespace: string | null;
  organizationId: string | null;
  userId: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  user?: UserSummary | null;
  bundleSubscriptions?: ClientBundleSub[];
}
