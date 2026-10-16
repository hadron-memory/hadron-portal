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

/** A board or tree row. */
export interface AgentTaskRow {
  id: string;
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
  appId: string;
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
