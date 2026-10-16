import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import {
  AGENT_ALARMS_QUERY,
  AGENT_TASK_ANCESTOR_QUERY,
  AGENT_TASKS_APP_QUERY,
  AGENT_TASK_EVENTS_QUERY,
  AGENT_TASK_TREE_QUERY,
  AGENT_TASKS_BOARD_QUERY,
  AGENT_TASKS_OPEN_TITLES_QUERY,
  TEAM_ROSTER_QUERY,
} from '$lib/server/queries';
import { boardFilterArgs, type BoardFilter } from '$lib/agent-tasks/status';
import type { AgentAlarm, AgentTaskRow, AgentTeamEvent, TaskRead, TeamRoster } from '$lib/agent-tasks/types';

/**
 * portal#1052 — the Tasks views' reads.
 *
 * Each read reports one of three outcomes, so a view never confuses them
 * (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch):
 *   - `ok` with the rows;
 *   - `not-participant`: the server answered APP_NOT_FOUND, which is what a
 *     task read says to anyone who doesn't take part in the App
 *     (hrn:node:hadronmemory.com:specs:cor:agt:050:21). Only that code maps
 *     here (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only);
 *   - `failed`: anything else, never shown as an empty list.
 */
export type { TaskRead };

function classify<T>(e: unknown, what: string): TaskRead<T> {
  if (extractGqlErrorCode(e) === 'APP_NOT_FOUND') return { kind: 'not-participant' };
  console.warn(`[agent-tasks] ${what} failed:`, e);
  return { kind: 'failed' };
}

/** The board reads up to this many roots; the server's cap. */
export const BOARD_LIMIT = 200;

/**
 * The board's roots for one filter. `agentTasks` has no total, so a full page
 * is reported as `capped`: the view says there may be more rather than
 * claiming the list is whole
 * (hrn:node:hadronmemory.com:hadron-portal:review:short-page-is-not-end-of-data).
 */
export async function loadBoard(
  client: GraphQLClient,
  appRef: string,
  filter: BoardFilter,
): Promise<TaskRead<{ tasks: AgentTaskRow[]; capped: boolean }>> {
  try {
    const r = await client.request<{ agentTasks: AgentTaskRow[] }>(AGENT_TASKS_BOARD_QUERY, {
      appRef,
      ...boardFilterArgs(filter),
      limit: BOARD_LIMIT,
    });
    return { kind: 'ok', value: { tasks: r.agentTasks, capped: r.agentTasks.length >= BOARD_LIMIT } };
  } catch (e) {
    return classify(e, `board read for ${appRef}`);
  }
}

/** The server bounds a tree at this many rows. */
export const TREE_LIMIT = 1000;

/** A task and everything below it, the task first. `null` value: the root is missing or unreadable. */
export async function loadTree(
  client: GraphQLClient,
  taskId: string,
): Promise<TaskRead<{ rows: AgentTaskRow[]; capped: boolean } | null>> {
  try {
    const r = await client.request<{ agentTaskTree: AgentTaskRow[] | null }>(AGENT_TASK_TREE_QUERY, { root: taskId });
    if (!r.agentTaskTree) return { kind: 'ok', value: null };
    return { kind: 'ok', value: { rows: r.agentTaskTree, capped: r.agentTaskTree.length >= TREE_LIMIT } };
  } catch (e) {
    return classify(e, `tree read for ${taskId}`);
  }
}

const EVENTS_PAGE = 200;
/** A task's history is read to this bound; past it the view says so. */
export const HISTORY_LIMIT = 1000;

/**
 * One task's history, oldest first. `agentTeamEvents` pages forward only, by
 * `after`, so this walks until a short page or the bound. A short page is the
 * end here because the walk continues from the last id it read, not from an
 * offset that concurrent writes could shift.
 */
export async function loadHistory(
  client: GraphQLClient,
  appRef: string,
  taskId: string,
): Promise<TaskRead<{ events: AgentTeamEvent[]; capped: boolean }>> {
  const events: AgentTeamEvent[] = [];
  let after: string | undefined;
  try {
    while (events.length < HISTORY_LIMIT) {
      const r = await client.request<{ agentTeamEvents: AgentTeamEvent[] }>(AGENT_TASK_EVENTS_QUERY, {
        appRef,
        taskId,
        after,
        limit: EVENTS_PAGE,
      });
      events.push(...r.agentTeamEvents);
      if (r.agentTeamEvents.length < EVENTS_PAGE) return { kind: 'ok', value: { events, capped: false } };
      after = r.agentTeamEvents[r.agentTeamEvents.length - 1].id;
    }
    return { kind: 'ok', value: { events: events.slice(0, HISTORY_LIMIT), capped: true } };
  } catch (e) {
    return classify(e, `history read for ${taskId}`);
  }
}

/** The breadcrumb follows this many parents; a deeper chain shows an ellipsis. */
export const ANCESTOR_LIMIT = 8;

export type TaskAncestor = { id: string; title: string };

/**
 * A task's parents, root first, for the breadcrumb. Best-effort: a failed or
 * unreadable link ends the chain there and marks it `truncated`, and the
 * page still renders (the Parent fact links the direct parent regardless).
 */
export async function loadAncestors(
  client: GraphQLClient,
  parentTaskId: string | null,
): Promise<{ ancestors: TaskAncestor[]; truncated: boolean }> {
  const chain: TaskAncestor[] = [];
  let next = parentTaskId;
  try {
    while (next && chain.length < ANCESTOR_LIMIT) {
      const r = await client.request<{ agentTask: { id: string; title: string; parentTaskId: string | null } | null }>(
        AGENT_TASK_ANCESTOR_QUERY,
        { id: next },
      );
      if (!r.agentTask) return { ancestors: chain.reverse(), truncated: true };
      chain.push({ id: r.agentTask.id, title: r.agentTask.title });
      next = r.agentTask.parentTaskId;
    }
  } catch (e) {
    console.warn(`[agent-tasks] ancestor read failed at ${next}:`, e);
    return { ancestors: chain.reverse(), truncated: true };
  }
  return { ancestors: chain.reverse(), truncated: next !== null };
}

// ── slice 2: the Roster and the Alarms list ────────────────────────────────

export async function loadRoster(client: GraphQLClient, appRef: string): Promise<TaskRead<TeamRoster>> {
  try {
    const r = await client.request<{ teamRoster: TeamRoster }>(TEAM_ROSTER_QUERY, { appRef });
    return { kind: 'ok', value: r.teamRoster };
  } catch (e) {
    return classify(e, `roster read for ${appRef}`);
  }
}

/**
 * Titles for the bare task ids the Roster and Alarms carry: the App's open
 * tasks, read once (design §6). An id outside this set still renders, as
 * "Task <short id>" linked to its page, never as "no task". A failure here
 * only costs the titles, so it reads as an empty map and is logged.
 */
export async function loadOpenTaskTitles(client: GraphQLClient, appRef: string): Promise<Record<string, string>> {
  try {
    const r = await client.request<{ agentTasks: { id: string; title: string }[] }>(AGENT_TASKS_OPEN_TITLES_QUERY, {
      appRef,
      limit: BOARD_LIMIT,
    });
    return Object.fromEntries(r.agentTasks.map((t) => [t.id, t.title]));
  } catch (e) {
    console.warn(`[agent-tasks] open-task titles failed for ${appRef}:`, e);
    return {};
  }
}

/** The Alarms list reads this many alarms at most; past it the view says so. */
export const ALARMS_LIMIT = 2000;

/**
 * Every alarm in the App, oldest first, walked forward by `after` (design §7).
 * The server reads alarms only oldest-first today, so reaching the newest
 * means walking the stream; the view sorts newest first. Past the bound it
 * says newer alarms may be missing.
 */
export async function loadAlarms(
  client: GraphQLClient,
  appRef: string,
): Promise<TaskRead<{ alarms: AgentAlarm[]; capped: boolean }>> {
  const alarms: AgentAlarm[] = [];
  let after: string | undefined;
  try {
    while (alarms.length < ALARMS_LIMIT) {
      const r = await client.request<{ agentTeamEvents: AgentAlarm[] }>(AGENT_ALARMS_QUERY, { appRef, after, limit: EVENTS_PAGE });
      alarms.push(...r.agentTeamEvents);
      if (r.agentTeamEvents.length < EVENTS_PAGE) return { kind: 'ok', value: { alarms, capped: false } };
      after = r.agentTeamEvents[r.agentTeamEvents.length - 1].id;
    }
    return { kind: 'ok', value: { alarms: alarms.slice(0, ALARMS_LIMIT), capped: true } };
  } catch (e) {
    return classify(e, `alarms read for ${appRef}`);
  }
}

export type TasksApp = { id: string; name: string; urn: string; organizationId: string | null };

/**
 * The App a Tasks view hangs off, or null when the viewer can't see it.
 *
 * `app(ref:)` refuses a viewer with no access to the App (FORBIDDEN), and
 * graphql-request throws on that. The App page answers it with a 404, so the
 * Tasks views do the same instead of a 500 (Uma's P2-2 on #1127).
 *
 * Only the access and missing codes become a 404 (Atilla's P2 on #1127,
 * hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 * Anything else, an INTERNAL_SERVER_ERROR, an HTTP 500 with no data, a
 * transport failure, rethrows and stays a failure, never a misleading
 * "not found".
 */
const APP_REFUSED_CODES = new Set(['FORBIDDEN', 'NOT_FOUND']);

export async function loadTasksApp(client: GraphQLClient, ref: string): Promise<TasksApp | null> {
  try {
    const r = await client.request<{ app: TasksApp | null }>(AGENT_TASKS_APP_QUERY, { ref });
    return r.app;
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code && APP_REFUSED_CODES.has(code)) return null;
    throw e;
  }
}
