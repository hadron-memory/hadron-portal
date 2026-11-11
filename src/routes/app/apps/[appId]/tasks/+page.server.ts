import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { BOARD_LIMIT, loadAlarms, loadBoard, hydrateTaskRefs, loadComposition, loadRoster, loadTasksApp } from '$lib/server/agent-tasks';
import { parseBoardFilter } from '$lib/agent-tasks/status';
import { parseNarrow, parseTags } from '$lib/agent-tasks/narrow';
import { parseAlarmFilter, rosterTaskIds } from '$lib/agent-tasks/roster';
import type { TaskRefs } from '$lib/agent-tasks/types';
import { parseTaskView } from '$lib/agent-tasks/views';
import type { PageServerLoad } from './$types';


/**
 * portal#1052 — the App's Tasks sub-route: Board · Roster · Composition · Alarms, read-only
 * (Holger #10660). A sub-route of its own, like Runs and Channels, so a task
 * read that refuses a non-participant (APP_NOT_FOUND) can never reach the App
 * page's loader, and the board, a filter and a task are each linkable
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §2).
 *
 * Only the view on screen is read.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const view = parseTaskView(url.searchParams.get('view'));
  const text = (url.searchParams.get('text') ?? '').trim();
  const filter = parseBoardFilter(url.searchParams.get('status'));
  const { narrow, overdueDropped } = parseNarrow(url.searchParams, filter);
  const alarmFilter = parseAlarmFilter(url.searchParams.get('alarms'));

  // The App's header comes first and alone: a missing App is a 404 whatever
  // the task read would have said.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  // Canonicalize crafted blank GETs too (including with JavaScript disabled).
  // Same for a blank tag list, and for an overdue value that is not the one
  // the form sends (a dropped Overdue keeps its 1 so the page can say so).
  const blankText = url.searchParams.has('text') && !text;
  const blankTags = url.searchParams.has('tags') && parseTags(url.searchParams.get('tags')).length === 0;
  const strayOverdue = url.searchParams.has('overdue') && url.searchParams.get('overdue') !== '1';
  if (view === 'board' && (blankText || blankTags || strayOverdue)) {
    const canonical = new URL(url);
    if (blankText) canonical.searchParams.delete('text');
    if (blankTags) canonical.searchParams.delete('tags');
    if (strayOverdue) canonical.searchParams.delete('overdue');
    throw redirect(303, canonical.pathname + canonical.search);
  }

  const base = {
    app,
    view,
    filter,
    alarmFilter,
    text,
    overdue: narrow.overdue,
    tags: narrow.tags,
    overdueDropped,
    boardLimit: BOARD_LIMIT,
    alarmPaging: null as { previousHref: string | null; nextHref: string | null } | null,
    loadedAt: new Date().toISOString(),
    // §8: a non-participant who is impersonating is told whose view it is.
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };

  if (view === 'roster') {
    const roster = await loadRoster(client, app.id);
    // Only the references the loaded roster carries, each through the readable-task gate.
    const refs = await hydrateTaskRefs(client, app.id, roster.kind === 'ok' ? rosterTaskIds(roster.value) : []);
    return { ...base, board: null, roster, composition: null, alarms: null, refs };
  }
  if (view === 'composition') {
    return { ...base, board: null, roster: null, composition: await loadComposition(client, app.id), alarms: null, refs: {} as TaskRefs };
  }
  if (view === 'alarms') {
    const before = url.searchParams.get('alarmBefore') || undefined;
    const after = url.searchParams.get('alarmAfter') || undefined;
    if (before && after) throw error(400, 'Choose one alarm page direction');
    const alarms = await loadAlarms(client, app.id, before, after);
    const href = (key: 'alarmBefore' | 'alarmAfter', cursor: string) => {
      const target = new URL(url);
      target.searchParams.delete('alarmBefore');
      target.searchParams.delete('alarmAfter');
      target.searchParams.set(key, cursor);
      return target.pathname + target.search;
    };
    const alarmPaging = {
      previousHref: alarms.kind === 'ok' && alarms.value.previousAfter
        ? href('alarmAfter', alarms.value.previousAfter) : null,
      nextHref: alarms.kind === 'ok' && alarms.value.nextBefore
        ? href('alarmBefore', alarms.value.nextBefore) : null,
    };
    const refs = await hydrateTaskRefs(client, app.id, alarms.kind === 'ok' ? alarms.value.alarms.map((a) => a.taskId) : []);
    return { ...base, board: null, roster: null, composition: null, alarms, refs, alarmPaging };
  }
  const board = await loadBoard(client, app.id, filter, text, narrow);
  return { ...base, board, roster: null, composition: null, alarms: null, refs: {} as TaskRefs };
};
