export interface GraphConfig {
  id: string;
  organizationId: string;
  name: string;
  source: string | null;
  readBranch: string | null;
  writeBranch: string | null;
  visibility: string;
  version: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptions?: GraphSubscription[];
}

export interface GraphSubscription {
  id: string;
  role: string;
  createdAt: string;
  graph: GraphConfig;
  organization: OrgSummary;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  githubInstallationId: number | null;
  createdAt: string;
  updatedAt: string;
  members?: OrgMember[];
  graphs?: GraphConfig[];
  subscriptions?: GraphSubscription[];
}

export interface OrgMember {
  id: string;
  role: string;
  createdAt: string;
  user: UserSummary;
}

export interface UserSummary {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  roles?: string[];
}

export interface Client {
  id: string;
  label: string;
  type: string;
  description: string | null;
  roles: string[];
  namespace: string | null;
  organizationId: string | null;
  userId: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  user?: UserSummary | null;
  graphs?: GraphConfig[];
}
