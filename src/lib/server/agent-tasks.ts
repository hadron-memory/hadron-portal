import { error } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { resolveSegment } from '$lib/agent-tasks/handle';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import {
  AGENT_ALARMS_QUERY,
  AGENT_ALARMS_IN_EFFECT_QUERY,
  AGENT_TASK_ANCESTOR_QUERY,
  AGENT_TASKS_APP_QUERY,
  AGENT_TASK_EVENTS_QUERY,
  AGENT_TASK_TREE_QUERY,
  AGENT_TASKS_BOARD_QUERY,
  AGENT_TASK_REF_QUERY,
  APP_PEOPLE_QUERY,
  PULL_REQUEST_READINESS_QUERY,
  TASK_REVIEW_EVENTS_QUERY,
  TEAM_COMPOSITION_QUERY,
  TEAM_ROSTER_QUERY,
} from '$lib/server/queries';
import { rosterOf } from '$lib/withheld';
import { REVIEW_EVENT_TYPES, reviewFacts, type PullRequestReadiness, type TaskReviewOutcome } from '$lib/agent-tasks/review';
import { boardFilterArgs, type BoardFilter } from '$lib/agent-tasks/status';
import { NO_NARROW, narrowArgs, type BoardNarrow } from '$lib/agent-tasks/narrow';
import type { AgentAlarm, AgentTaskRow, AgentTeamEvent, TaskRead, TaskRefs, TeamComposition, TeamRoster, WriteCandidates } from '$lib/agent-tasks/types';

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
  text = '',
  narrow: BoardNarrow = NO_NARROW,
): Promise<TaskRead<{ tasks: AgentTaskRow[]; capped: boolean }> | { kind: 'invalid-search' }> {
  try {
    const r = await client.request<{ agentTasks: AgentTaskRow[] }>(AGENT_TASKS_BOARD_QUERY, {
      appRef,
      ...boardFilterArgs(filter),
      ...(text.trim() ? { text: text.trim() } : {}),
      ...narrowArgs(narrow),
      limit: BOARD_LIMIT,
    });
    return { kind: 'ok', value: { tasks: r.agentTasks, capped: r.agentTasks.length >= BOARD_LIMIT } };
  } catch (e) {
    if (text.trim() && extractGqlErrorCode(e) === 'BAD_USER_INPUT') return { kind: 'invalid-search' };
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
 * Walks one task's events forward by `after`, oldest first. A short page is the
 * end here because the walk continues from the last id it read, not from an
 * offset that concurrent writes could shift.
 *
 * `agentTeamEvents` gives no count or `hasMore`, so a stream that reaches the
 * bound on a full page takes one more page to tell "exactly the bound" from
 * "more": at most six reads (portal#1713). `over` has to be judged before the
 * short-page exit, or a short sixth page reads as complete. This reports what
 * those reads returned; it promises no snapshot of a stream still being written.
 */
async function readEvents<T extends { id: string }>(
  read: (after: string | undefined) => Promise<T[]>,
): Promise<{ events: T[]; over: boolean }> {
  const events: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await read(after);
    events.push(...page);
    if (events.length > HISTORY_LIMIT) return { events: events.slice(0, HISTORY_LIMIT), over: true };
    if (page.length < EVENTS_PAGE) return { events, over: false };
    after = page[page.length - 1].id;
  }
}

/**
 * One task's history, oldest first. A failure on any page, the sixth included,
 * is a failure: without that page the view can't tell complete from capped, so
 * it shows neither rather than the rows it holds (the gate on portal#1713).
 */
export async function loadHistory(
  client: GraphQLClient,
  appRef: string,
  taskId: string,
): Promise<TaskRead<{ events: AgentTeamEvent[]; capped: boolean }>> {
  try {
    const { events, over } = await readEvents(async (after) => {
      const r = await client.request<{ agentTeamEvents: AgentTeamEvent[] }>(AGENT_TASK_EVENTS_QUERY, {
        appRef,
        taskId,
        after,
        limit: EVENTS_PAGE,
      });
      return r.agentTeamEvents;
    });
    return { kind: 'ok', value: { events, capped: over } };
  } catch (e) {
    return classify(e, `history read for ${taskId}`);
  }
}

/**
 * portal#1697 — a task's Review section (hadron-server#3448).
 *
 * `pullRequestReadiness` needs the head, so the frozen head comes first, from
 * the task's own `pr.frozen` events and never from the `pr.head` property
 * mirror, which any writer may change and which decides nothing
 * (hrn:node:hadronmemory.com:specs:cor:agt:130:03). The events read oldest
 * first, so the whole stream is read to reach the newest.
 *
 * portal#1713: past the bound the newest is unknown, and a malformed newest
 * event is not a fact. Both are `unreadable`, with no readiness read, so no old
 * head is ever called current. The log gets the task id and the reason, never
 * the payload.
 *
 * No freeze, or REVIEW_SCHEDULE_MISSING, is a task with no schedule: no section
 * and no error. A null answer is the server's concealment, the not-participant
 * state. PR_HEAD_NOT_FROZEN (another freeze landed between the two reads) stays
 * a failure, whose line says to reload.
 */
export async function loadReview(client: GraphQLClient, appRef: string, taskId: string): Promise<TaskReviewOutcome> {
  type ReviewEvent = { id: string; type: string; payload: unknown };
  let stream: { events: ReviewEvent[]; over: boolean };
  try {
    stream = await readEvents(async (after) => {
      const r = await client.request<{ agentTeamEvents: ReviewEvent[] }>(TASK_REVIEW_EVENTS_QUERY, {
        appRef,
        taskId,
        types: REVIEW_EVENT_TYPES,
        after,
        limit: EVENTS_PAGE,
      });
      return r.agentTeamEvents;
    });
  } catch (e) {
    return classify(e, `review events for ${taskId}`);
  }
  if (stream.over) {
    console.warn(`[agent-tasks] review events for ${taskId} passed the bound`);
    return { kind: 'unreadable' };
  }
  const facts = reviewFacts(stream.events);
  if (facts.kind === 'malformed') {
    console.warn(`[agent-tasks] review events for ${taskId}: newest ${facts.eventType} is malformed`);
    return { kind: 'unreadable' };
  }
  const { head, seat } = facts;
  if (!head) return { kind: 'ok', value: { readiness: null, seat } };
  try {
    const r = await client.request<{ pullRequestReadiness: PullRequestReadiness | null }>(PULL_REQUEST_READINESS_QUERY, { taskRef: taskId, head });
    if (!r.pullRequestReadiness) return { kind: 'not-participant' };
    return { kind: 'ok', value: { readiness: r.pullRequestReadiness, seat } };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'REVIEW_SCHEDULE_MISSING') return { kind: 'ok', value: { readiness: null, seat } };
    return classify(e, `readiness read for ${taskId}`);
  }
}

/** The breadcrumb follows this many parents; a deeper chain shows an ellipsis. */
export const ANCESTOR_LIMIT = 8;

export type TaskAncestor = { id: string; handle: string; title: string };

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
      const r = await client.request<{ agentTask: { id: string; handle: string; title: string; parentTaskId: string | null } | null }>(
        AGENT_TASK_ANCESTOR_QUERY,
        { id: next },
      );
      if (!r.agentTask) return { ancestors: chain.reverse(), truncated: true };
      chain.push({ id: r.agentTask.id, handle: r.agentTask.handle, title: r.agentTask.title });
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
 * portal#1349 — the canonical task id a route segment (an id or a handle)
 * names inside THIS App, for a write. The App is read first (a non-participant
 * gets the App's 404), the segment is qualified with that App by
 * `resolveSegment`, and the server's resolver answers; a task that is missing,
 * unreadable (answered null or refused) or another App's is the same 404. A
 * transport failure or unknown fault is thrown as is. The raw segment is never
 * a mutation identity.
 */
export async function canonicalTaskId(client: GraphQLClient, appId: string, segment: string): Promise<string> {
  const app = await loadTasksApp(client, appId);
  if (!app) throw error(404, 'App not found');
  const seg = resolveSegment(segment, app.urn);
  if (seg.kind === 'unknown') throw error(404, 'Task not found, or you can’t see it');
  let r: { agentTask: { id: string; appId: string } | null };
  try {
    r = await client.request(AGENT_TASK_REF_QUERY, { id: seg.ref });
  } catch (e) {
    // A refusal is the same 404 as a null answer; any other failure is the caller's to classify.
    if (TASK_REF_REFUSALS.has(extractGqlErrorCode(e) ?? '')) throw error(404, 'Task not found, or you can’t see it');
    throw e;
  }
  if (!r.agentTask || r.agentTask.appId !== app.id) throw error(404, 'Task not found, or you can’t see it');
  return r.agentTask.id;
}

/** The resolution read's answers that mean "not one you can see": never told apart (portal#1349). */
const TASK_REF_REFUSALS = new Set(['FORBIDDEN', 'NOT_FOUND', 'TASK_NOT_FOUND', 'APP_NOT_FOUND']);

/** Bounded concurrency for reference hydration: a finite page of ids, never a flood. */
export const HYDRATE_CONCURRENCY = 6;

/**
 * portal#1349 — display info for the bare task ids the Roster, Alarms and AI
 * Team grid carry. Each distinct id is read once through `agentTask(id)`, the
 * server's own readable-task gate, so terminal children and old alarm tasks
 * resolve as completely as open ones (a capped open-only scan would not).
 *
 * A task of another App is never used to decorate this App's row, and an id
 * the server answers null for, refuses, or fails on is `null` (unavailable): no
 * stale title or handle, and no distinction between the reasons.
 */
export async function hydrateTaskRefs(
  client: GraphQLClient,
  appId: string,
  ids: Iterable<string | null | undefined>,
): Promise<TaskRefs> {
  const distinct = [...new Set([...ids].filter((id): id is string => typeof id === 'string' && id !== ''))];
  const out: TaskRefs = {};
  let next = 0;
  async function worker() {
    while (next < distinct.length) {
      const id = distinct[next++]!;
      try {
        const r = await client.request<{ agentTask: { id: string; appId: string; handle: string; title: string } | null }>(
          AGENT_TASK_REF_QUERY,
          { id },
        );
        const task = r.agentTask;
        out[id] = task && task.appId === appId ? { id: task.id, handle: task.handle, title: task.title } : null;
      } catch (e) {
        console.warn(`[agent-tasks] task ref hydration failed (${extractGqlErrorCode(e) ?? 'transport'})`);
        out[id] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(HYDRATE_CONCURRENCY, distinct.length) }, worker));
  return out;
}

/** Each newest-first read serves one table page plus a look-ahead row. */
export const ALARMS_PAGE_SIZE = 20;

/** #1935 / server#3933: one bounded newest-end read, continued by before.
 * No history walk or total cap. The look-ahead is not served, so the next
 * cursor is the oldest row actually shown, not the row beyond the page.
 *
 * portal#2000 A: `inEffect` asks the server for alarms in effect only
 * (#3934's alarmsInEffect — unacknowledged and no recorded escalation end,
 * hrn:node:hadronmemory.com:specs:cor:agt:050:20). The server applies it App-wide before cutting the page
 * through the unchanged gate and order, so an empty page there means none
 * in effect anywhere the viewer may read — not "none on this page". The
 * reads are separate documents (see queries.ts): the in-effect one names the
 * new argument, and every other filter's read stays byte-identical to its
 * pre-#2000 wire shape.
 */
export async function loadAlarms(
  client: GraphQLClient,
  appRef: string,
  before?: string,
  after?: string,
  inEffect = false,
): Promise<TaskRead<{ alarms: AgentAlarm[]; nextBefore: string | null; previousAfter: string | null }>> {
  try {
    const r = await client.request<{ agentTeamEvents: AgentAlarm[] }>(
      inEffect ? AGENT_ALARMS_IN_EFFECT_QUERY : AGENT_ALARMS_QUERY,
      { appRef, before, after, newestFirst: !after, limit: ALARMS_PAGE_SIZE + 1 });
    const more = r.agentTeamEvents.length > ALARMS_PAGE_SIZE;
    const alarms = r.agentTeamEvents.slice(0, ALARMS_PAGE_SIZE);
    // The legacy ascending read starts immediately above after; reverse only
    // the served rows (not the look-ahead) to retrace the preceding page.
    if (after) alarms.reverse();
    return { kind: 'ok', value: { alarms,
      nextBefore: alarms.length && (after || more) ? alarms[alarms.length - 1].id : null,
      previousAfter: alarms.length && (after ? more : before) ? alarms[0].id : null } };

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
