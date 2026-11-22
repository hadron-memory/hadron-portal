/**
 * The `teamMetrics` answer as the server returns it (hadron-server#4848,
 * `hrn:node:hadronmemory.com:specs:cor:agt:150`, Proposed). The portal computes nothing from it: every figure on
 * the page is a field here (portal#1856).
 */
export type MetricsCount = { total: number; ids: string[]; truncated: boolean };
export type MetricsProject = { handle: string; noProject: boolean; taskId: string | null; title: string | null };
export type MetricsParty = { id: string; kind: string; name: string | null; urn: string | null };
export type MetricsOwnerGroup = {
  owner: MetricsParty | null;
  tasks: MetricsCount;
  projectsTruncated: boolean;
  byProject: { project: MetricsProject; tasks: MetricsCount }[];
};
export type MetricsStartedOwned = { all: MetricsCount; ownersTruncated: boolean; byOwner: MetricsOwnerGroup[] };
export type MetricsProjects = {
  truncated: boolean;
  items: { project: MetricsProject; children: { status: string; tasks: MetricsCount }[] }[];
};
export type MetricsWorkers = { active: MetricsCount; idle: MetricsCount; overdue: MetricsCount; inop: MetricsCount };
export type MetricsFlow = { completed: MetricsCount; started: MetricsCount };
export type TeamMetrics = {
  appId: string;
  asOf: string;
  window: { since: string; until: string };
  /** null for a reader who may see the roster but not the App's tasks (hrn:node:hadronmemory.com:specs:cor:agt:050:21). */
  startedOwned: MetricsStartedOwned | null;
  projects: MetricsProjects | null;
  flow: MetricsFlow | null;
  workers: MetricsWorkers;
};

/**
 * `hidden` is the server's one APP_NOT_FOUND answer (no standing, outsider, missing App: never
 * told apart); `invalid` is its BAD_USER_INPUT for a bad window; `failed` is anything else.
 */
export type TeamMetricsView =
  | { kind: 'ok'; metrics: TeamMetrics }
  | { kind: 'hidden' }
  | { kind: 'invalid'; metrics: TeamMetrics | null }
  | { kind: 'failed' };
