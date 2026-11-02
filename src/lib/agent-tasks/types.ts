import type { TaskReference } from './references';
/**
 * portal#1052 — the agent-task read shapes the Tasks views select, mirroring
 * the server SDL (schema/schema.graphql, hadron-server 4c55560a). Only the
 * fields a view renders are here; each query selects exactly these.
 */

export type AgentTaskStatus = 'BACKLOG' | 'PENDING' | 'STARTED' | 'FINISHED' | 'CANCELLED';

/** A worker or a person. A worker carries its URN; a person has none in this shape. */
export interface AgentTaskParty {
  id: string;
  kind: 'WORKER' | 'USER';
  name: string | null;
  urn: string | null;
}

export interface AgentTaskRequirements {
  role: string | null;
  familyIn: string[] | null;
  familyNotIn: string[] | null;
  excludeWorkerIds: string[] | null;
  /** portal#1523: the lowest model tier the matcher may assign (low < mid < high); null = no minimum. */
  minTier?: string | null;
}

export interface AgentTaskResult {
  outcome: string;
  summary: string | null;
  evidence: string | null;
}

export interface AgentTaskSessionEndRequest {
  requestedAt: string;
  dueAt: string;
  resolution: 'ENDED' | 'END_ISSUED' | 'NO_LIVE_HOST' | null;
  resolvedAt: string | null;
}

export interface AgentTaskHandBack {
  code: string;
  text: string | null;
  handedBackAt: string;
}

/** A board or tree row. */
export interface AgentTaskRow {
  /** Missing data stays unknown; the blocked flag is never reconstructed from relations. */
  priority?: number | null;
  blocked?: boolean | null;
  id: string;
  /** The immutable short handle (`AT3.405`), from server#2579. */
  handle: string;
  parentTaskId: string | null;
  title: string;
  status: AgentTaskStatus;
  queued: boolean;
  waitingOnChildren: boolean;
  source: string | null;
  owner: AgentTaskParty;
  assignee: AgentTaskParty | null;
  startBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  tags: string[];
}

/** The detail page's task: every field §5.1 shows. */
export interface AgentTaskDetail extends AgentTaskRow {
  /** portal#1607: the outside item the task claimed (cor:agt:120:02); set once at create. */
  externalId?: string | null;
  appId: string;
  /**
   * portal#1575 (hadron-server#3112, hrn:node:hadronmemory.com:specs:cor:agt:050:01): the task's typed references, in order, empty when
   * none. Untrusted stored strings: draw them only through `$lib/agent-tasks/references`.
   */
  references?: TaskReference[];
  description: string | null;
  requirements: AgentTaskRequirements | null;
  createdBy: AgentTaskParty | null;
  createdByRunId: string | null;
  assignedAt: string | null;
  assignedBy: AgentTaskParty | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  closeSessionWhenDone: boolean;
  result: AgentTaskResult | null;
  sessionEndRequest: AgentTaskSessionEndRequest | null;
  /** portal#1571: the latest hand-back (hadron-server#2651); null when the task was never handed back. */
  handBack?: AgentTaskHandBack | null;
  /**
   * portal#1340 (hadron-server#2420): the task's OWN optional JSON object, opaque to the platform.
   * Never inherited from a parent; null when unset. The detail query selects it, so it needs a server that has the field
   * (hadron-server#2877); a server without it rejects the read rather than omitting the field.
   */
  properties?: unknown;
}

export interface AgentTeamAlarmWake {
  chainIndex: number;
  dueAt: string;
  wokenAt: string | null;
  owner: AgentTaskParty | null;
}

export interface AgentTeamEvent {
  id: string;
  type: string;
  severity: 'ALARM' | null;
  createdAt: string;
  actor: AgentTaskParty | null;
  actorRunId: string | null;
  subjectWorker: AgentTaskParty | null;
  /** Untyped JSON on the wire: ids, counts, outcome words and flags only, never text. */
  payload: Record<string, unknown> | null;
  acknowledgedAt: string | null;
  acknowledgedBy: AgentTaskParty | null;
  wakes: AgentTeamAlarmWake[] | null;
}

/** portal#1052 slice 2 — one worker on the roster (`teamRoster`). Task references are bare ids. */
export interface TeamRosterEntry {
  worker: AgentTaskParty;
  role: string | null;
  state: string;
  family: string | null;
  freeFamilies: string[];
  launchableFamilies: string[];
  unavailableFamilies: string[];
  unavailableReason: 'STALLED' | 'OUT_OF_TOKENS' | 'HOST_DOWN' | 'OTHER' | null;
  unavailableUntil: string | null;
  bound: boolean;
  liveSession: boolean;
  lastActiveAt: string | null;
  lastAssignedAt: string | null;
  reportsTo: AgentTaskParty | null;
  reportsToRetired: boolean;
  startedTasks: string[];
  pendingTasks: string[];
  waitingOn: string[];
  waitingSince: string | null;
  unreactedChildTask: string | null;
  alarms: string[];
}

export interface TeamRoster {
  asOf: string;
  workers: TeamRosterEntry[];
}

/**
 * portal#1316 (hadron-server#2061 / #2475) — `teamComposition`: the roster's
 * workers grouped by their direct `reportsTo` coordinator, with the server's
 * own headcounts. Lanes arrive ordered by coordinator name, the unassigned
 * (null-coordinator) lane last; roles and families arrive null-last. The page
 * keeps that order and recounts nothing.
 */
export interface TeamCompositionWorker {
  worker: AgentTaskParty;
  role: string | null;
  family: string | null;
  /** A session is bound, and a live session is another fact: neither alone is availability or permission. */
  bound: boolean;
  liveSession: boolean;
  state: string;
}

export interface TeamCompositionLane {
  /** Null for the single unassigned lane. */
  coordinator: AgentTaskParty | null;
  coordinatorRetired: boolean;
  workers: TeamCompositionWorker[];
  countsByRole: { role: string | null; count: number }[];
  countsByRoleFamily: { role: string | null; family: string | null; count: number }[];
}

export interface TeamComposition {
  appId: string;
  asOf: string;
  lanes: TeamCompositionLane[];
}

/** An alarm as the Alarms list reads it: `AgentTeamEvent` with `alarmsOnly`. */
export interface AgentAlarm {
  id: string;
  type: string;
  severity: 'ALARM' | null;
  taskId: string | null;
  createdAt: string;
  subjectWorker: AgentTaskParty | null;
  acknowledgedAt: string | null;
  acknowledgedBy: AgentTaskParty | null;
  wakes: AgentTeamAlarmWake[] | null;
}

/**
 * A Tasks-view read's outcome (portal#1052): the value, a non-participant
 * (the server's APP_NOT_FOUND), or a failure that is never shown as empty.
 */
export type TaskRead<T> = { kind: 'ok'; value: T } | { kind: 'not-participant' } | { kind: 'failed' };

/** portal#1090 — the owner and assignee pickers' options. */
export type WriteCandidates = {
  workers: { id: string; name: string; role: string | null; urn: string | null }[];
  people: { id: string; handle: string | null; name: string | null }[];
  /** portal#1148 (hadron-server#2089): the App's member roster is WITHHELD from this viewer; `people` is then unknown, not empty. */
  peopleWithheld?: boolean;
  /** The members read FAILED (a reload can fix it): `people` is unknown, not empty, and not withheld. */
  peopleFailed?: boolean;
};

/**
 * portal#1349 — what a bare task id resolved to for display: its title and
 * immutable handle, read through the server's readable-task gate. `null` in a
 * refs map means unavailable (missing, unreadable, another App, or the read
 * failed); callers render a neutral label and never a stale title or handle.
 */
export interface TaskRefInfo {
  id: string;
  handle: string;
  title: string;
}
export type TaskRefs = Record<string, TaskRefInfo | null>;

export interface TaskChoice { id: string; appId: string; title: string; handle: string; status: string }
export interface TaskDependencyPage { items: TaskChoice[]; hasMore: boolean }
