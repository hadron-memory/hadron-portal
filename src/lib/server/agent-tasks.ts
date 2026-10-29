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
  APP_PEOPLE_QUERY,
  TEAM_COMPOSITION_QUERY,
  TEAM_ROSTER_QUERY,
} from '$lib/server/queries';
import { rosterOf } from '$lib/withheld';
import { boardFilterArgs, type BoardFilter } from '$lib/agent-tasks/status';
import type { AgentAlarm, AgentTaskRow, AgentTeamEvent, TaskRead, TeamComposition, TeamRoster, WriteCandidates } from '$lib/agent-tasks/types';

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

/** The board's read: the three outcomes every task read has, plus a refused search text. */
export type BoardRead = TaskRead<{ tasks: AgentTaskRow[]; capped: boolean }> | { kind: 'bad-text' };

/**
 * The board's roots for one filter and, optionally, a text search (portal#1400).
 * The server applies the text before its 200-root cap, so a match beyond the
 * first 200 roots is found. `agentTasks` has no total, so a full page is
 * reported as `capped`: the view says there may be more rather than claiming
 * the list is whole
 * (hrn:node:hadronmemory.com:hadron-portal:review:short-page-is-not-end-of-data).
 *
 * Blank text sends no `text` at all. A BAD_USER_INPUT on a read that carried
 * text is `bad-text`, never an empty board; the code only means "the text was
 * refused" when there was text, so without it that code stays a failure.
 */
export async function loadBoard(
  client: GraphQLClient,
  appRef: string,
  filter: BoardFilter,
  text?: string | null,
): Promise<BoardRead> {
  const search = text?.trim() ? text.trim() : null;
  try {
    const r = await client.request<{ agentTasks: AgentTaskRow[] }>(AGENT_TASKS_BOARD_QUERY, {
      appRef,
      ...boardFilterArgs(filter),
      ...(search ? { text: search } : {}),
      limit: BOARD_LIMIT,
    });
    return { kind: 'ok', value: { tasks: r.agentTasks, capped: r.agentTasks.length >= BOARD_LIMIT } };
  } catch (e) {
    if (search && extractGqlErrorCode(e) === 'BAD_USER_INPUT') return { kind: 'bad-text' };
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
 * portal#1316 — one `teamComposition` read for the App. The same three
 * outcomes as the Roster: a refusal (the server's APP_NOT_FOUND) is
 * `not-participant`, an outage is `failed`, and neither is ever an empty team.
 * The server's answer is returned untouched.
 */
export async function loadComposition(client: GraphQLClient, appRef: string): Promise<TaskRead<TeamComposition>> {
  try {
    const r = await client.request<{ teamComposition: TeamComposition }>(TEAM_COMPOSITION_QUERY, { appRef });
    return { kind: 'ok', value: r.teamComposition };
  } catch (e) {
    return classify(e, `composition read for ${appRef}`);
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

/**
 * Whether a read failed because the server conceals the entity from this
 * viewer (FORBIDDEN or NOT_FOUND), which an App sub-route shows as its 404.
 * Shared by the Tasks views and the runs pages (portal#1130), so every App
 * sub-route answers a no-access viewer the same way.
 */
export function isAccessRefusal(e: unknown): boolean {
  const code = extractGqlErrorCode(e);
  return code !== null && APP_REFUSED_CODES.has(code);
}

export async function loadTasksApp(client: GraphQLClient, ref: string): Promise<TasksApp | null> {
  try {
    const r = await client.request<{ app: TasksApp | null }>(AGENT_TASKS_APP_QUERY, { ref });
    return r.app;
  } catch (e) {
    if (isAccessRefusal(e)) return null;
    throw e;
  }
}

// ── portal#1090: who the write forms offer ───────────────────────────────

export type { WriteCandidates };

/**
 * The owner and assignee pickers' options (design §3.1, §6): the App's
 * workers from the roster (the server already leaves retired ones out) and
 * its members. The server's participant test is wider than this list, so
 * the pickers also take "Someone else…", and `TASK_ASSIGNEE_INVALID` /
 * `TASK_OWNER_INVALID` say the rest. A failed read costs only options, never
 * the page: it reads as an empty list and is logged.
 */
export async function loadWriteCandidates(
  client: GraphQLClient,
  appRef: string,
): Promise<WriteCandidates & { roles: string[]; families: string[] }> {
  const [roster, peopleRead] = await Promise.all([
    client
      .request<{ teamRoster: TeamRoster }>(TEAM_ROSTER_QUERY, { appRef })
      .then((r) => r.teamRoster.workers)
      .catch((e) => {
        console.warn(`[agent-tasks] picker roster read failed for ${appRef}:`, e);
        return [] as TeamRoster['workers'];
      }),
    client
      .request<{ app: { members: { user: { id: string; handle: string | null; name: string | null } | null }[] | null } | null }>(
        APP_PEOPLE_QUERY,
        { ref: appRef },
      )
      .then((r) => {
        // portal#1148: `members: null` is WITHHELD, not an App with no people.
        const members = rosterOf(r.app?.members);
        return members.kind === 'withheld'
          ? { people: [] as WriteCandidates['people'], withheld: true, failed: false }
          : { people: members.items.flatMap((m) => (m.user ? [m.user] : [])), withheld: false, failed: false };
      })
      .catch((e) => {
        console.warn(`[agent-tasks] picker people read failed for ${appRef}:`, e);
        return { people: [] as WriteCandidates['people'], withheld: false, failed: true };
      }),
  ]);
  const workers = roster.map((e) => ({ id: e.worker.id, name: e.worker.name ?? e.worker.id, role: e.role, urn: e.worker.urn }));
  const roles = [...new Set(roster.flatMap((e) => (e.role ? [e.role] : [])))].sort();
  const families = [
    ...new Set(roster.flatMap((e) => [e.family, ...e.freeFamilies, ...e.launchableFamilies, ...e.unavailableFamilies]).filter((f): f is string => !!f)),
  ].sort();
  return { workers, people: peopleRead.people, peopleWithheld: peopleRead.withheld, peopleFailed: peopleRead.failed, roles, families };
}
