import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ALARMS_LIMIT, BOARD_LIMIT, loadAlarms, loadBoard, loadComposition, loadOpenTaskTitles, loadRoster, loadTasksApp } from '$lib/server/agent-tasks';
import { parseBoardFilter } from '$lib/agent-tasks/status';
import { parseBoardText } from '$lib/agent-tasks/search';
import { parseAlarmFilter } from '$lib/agent-tasks/roster';
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
  const filter = parseBoardFilter(url.searchParams.get('status'));
  const text = parseBoardText(url.searchParams.get('text'));
  const alarmFilter = parseAlarmFilter(url.searchParams.get('alarms'));

  // The App's header comes first and alone: a missing App is a 404 whatever
  // the task read would have said.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const base = {
    app,
    view,
    filter,
    text,
    alarmFilter,
    boardLimit: BOARD_LIMIT,
    alarmsLimit: ALARMS_LIMIT,
    loadedAt: new Date().toISOString(),
    // §8: a non-participant who is impersonating is told whose view it is.
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };

  if (view === 'roster') {
    const [roster, titles] = await Promise.all([loadRoster(client, app.id), loadOpenTaskTitles(client, app.id)]);
    return { ...base, board: null, roster, composition: null, alarms: null, titles };
  }
  if (view === 'composition') {
    return { ...base, board: null, roster: null, composition: await loadComposition(client, app.id), alarms: null, titles: {} as Record<string, string> };
  }
  if (view === 'alarms') {
    const [alarms, titles] = await Promise.all([loadAlarms(client, app.id), loadOpenTaskTitles(client, app.id)]);
    return { ...base, board: null, roster: null, composition: null, alarms, titles };
  }
  const board = await loadBoard(client, app.id, filter, text);
  return { ...base, board, roster: null, composition: null, alarms: null, titles: {} as Record<string, string> };
};
